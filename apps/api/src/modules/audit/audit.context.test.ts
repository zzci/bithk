import type { Context } from "hono";
import type { AppDatabase } from "@/db";
import type { RequestEnv } from "@/shared/lib/types";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { auditFromCtx } from "./audit.context";
import { getAuditEventById } from "./audit.service";

let db: AppDatabase;
let dir: string;

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
};

// Minimal Hono context stub exposing the surfaces auditFromCtx reads:
// c.get("db"/"logger"/"config"/"user"), c.req.header, c.env.IP.
function ctx(user: { id: string; name: string } | undefined, headers: Record<string, string> = {}): Context<RequestEnv> {
  const vars: Record<string, unknown> = { db, logger: stubLogger, config: {}, user };
  return {
    get: (k: string) => vars[k],
    req: { header: (n: string) => headers[n.toLowerCase()] },
    env: { IP: { address: "10.0.0.9", port: 1, family: "IPv4" } },
  } as unknown as Context<RequestEnv>;
}

const ENTRY = {
  action: "thing.created",
  resourceType: "thing",
  resourceId: "t_1",
  resourceName: "a thing",
  result: "success",
} as const;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "audit-context-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auditFromCtx()", () => {
  test("derives actor, ip and user-agent from the context", async () => {
    const id = await auditFromCtx(ctx({ id: "u_1", name: "alice" }, { "user-agent": "test-agent" }), ENTRY);
    const row = await getAuditEventById(db, id!);
    expect(row).toMatchObject({ actorId: "u_1", actorName: "alice", ip: "10.0.0.9", userAgent: "test-agent", action: "thing.created" });
  });

  test("falls back to \"unknown\" for a missing user-agent header", async () => {
    const id = await auditFromCtx(ctx({ id: "u_1", name: "alice" }), ENTRY);
    const row = await getAuditEventById(db, id!);
    expect(row?.userAgent).toBe("unknown");
  });

  test("explicit actor/userAgent entries override the context-derived values", async () => {
    const id = await auditFromCtx(ctx(undefined), {
      ...ENTRY,
      actorId: "system",
      actorName: "system:backup-sidecar",
      userAgent: "service-token",
    });
    const row = await getAuditEventById(db, id!);
    expect(row).toMatchObject({ actorId: "system", actorName: "system:backup-sidecar", userAgent: "service-token" });
  });
});
