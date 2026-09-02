import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { SMTPServer } from "smtp-server";
import { createDb } from "@/db";
import { auditEvents } from "@/modules/audit/schema";
import { setSetting } from "@/modules/settings/settings.service";
import { mountRoutes, sessionCookieFor } from "@/shared/test/route-harness";
import { SMTP_SETTING_KEYS } from "./mail.service";
import { notificationRoutes } from "./notification.routes";
import "@/modules/account";

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "notify-routes-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function startSink(): Promise<{ port: number; count: () => number; close: () => Promise<void> }> {
  let count = 0;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    onData(stream, _session, callback) {
      stream.on("data", () => {});
      stream.on("end", () => {
        count++;
        callback();
      });
    },
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.server.address();
      resolvePort(typeof address === "object" && address ? address.port : 0);
    });
  });
  return { port, count: () => count, close: () => new Promise<void>(done => server.close(() => done())) };
}

async function enableSmtp(port: number): Promise<void> {
  await setSetting(db, SMTP_SETTING_KEYS.enabled, "true");
  await setSetting(db, SMTP_SETTING_KEYS.host, "127.0.0.1");
  await setSetting(db, SMTP_SETTING_KEYS.port, String(port));
  await setSetting(db, SMTP_SETTING_KEYS.fromAddress, "noreply@example.com");
}

const app = () => mountRoutes(db, [notificationRoutes]);
const post = (cookie?: string) => app().request("/admin/smtp/test", { method: "POST", headers: cookie ? { Cookie: cookie } : {} });

describe("POST /admin/smtp/test", () => {
  test("401 anonymous, 403 non-admin", async () => {
    expect((await post()).status).toBe(401);
    const { cookie } = await sessionCookieFor(db, "user");
    expect((await post(cookie)).status).toBe(403);
  });

  test("409 SMTP_DISABLED while smtp.enabled is not true", async () => {
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await post(cookie);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("SMTP_DISABLED");
  });

  test("409 SMTP_UNCONFIGURED when enabled without a host", async () => {
    await setSetting(db, SMTP_SETTING_KEYS.enabled, "true");
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await post(cookie);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("SMTP_UNCONFIGURED");
  });

  test("200 mails the calling admin and audits smtp.test", async () => {
    const sink = await startSink();
    try {
      await enableSmtp(sink.port);
      const { cookie, userId } = await sessionCookieFor(db, "admin");
      const res = await post(cookie);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { to: string; messageId: string } };
      expect(body.data.to).toBe(`${userId}@test.com`);
      expect(body.data.messageId).toBeTruthy();
      expect(sink.count()).toBe(1);
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, "smtp.test")).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.result).toBe("success");
    }
    finally {
      await sink.close();
    }
  });

  test("502 SMTP_SEND_FAILED with a generic message when the relay is unreachable, audited as failure", async () => {
    const sink = await startSink();
    const port = sink.port;
    await sink.close();
    await enableSmtp(port);
    const { cookie } = await sessionCookieFor(db, "admin");
    const res = await post(cookie);
    expect(res.status).toBe(502);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SMTP_SEND_FAILED");
    expect(body.error.message).not.toContain("ECONNREFUSED");
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, "smtp.test")).all();
    expect(rows[0]!.result).toBe("failure");
  });
});
