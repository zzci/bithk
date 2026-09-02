import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SMTPServer } from "smtp-server";
import { createDb } from "@/db";
import { setSetting } from "@/modules/settings/settings.service";
import { readSmtpConfig, sendMail, SMTP_SETTING_KEYS } from "./mail.service";

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
  reopen: () => {},
} as unknown as Logger;

interface Received {
  readonly from: string;
  readonly to: readonly string[];
  readonly raw: string;
}

/** Plaintext SMTP sink on an ephemeral loopback port (no AUTH, no STARTTLS). */
async function startSink(): Promise<{ port: number; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    onData(stream, session, callback) {
      let raw = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        raw += chunk;
      });
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map(r => r.address),
          raw,
        });
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
  return {
    port,
    received,
    close: () => new Promise<void>(done => server.close(() => done())),
  };
}

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "mail-service-"));
  db = await createDb(resolve(dir, "app.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function configure(db: AppDatabase, port: number, extra: Record<string, string> = {}): Promise<void> {
  const values: Record<string, string> = {
    [SMTP_SETTING_KEYS.enabled]: "true",
    [SMTP_SETTING_KEYS.host]: "127.0.0.1",
    [SMTP_SETTING_KEYS.port]: String(port),
    [SMTP_SETTING_KEYS.secure]: "false",
    [SMTP_SETTING_KEYS.fromAddress]: "noreply@example.com",
    [SMTP_SETTING_KEYS.fromName]: "Bit Notifier",
    ...extra,
  };
  for (const [key, value] of Object.entries(values))
    await setSetting(db, key, value);
}

describe("readSmtpConfig", () => {
  test("parses the settings rows with defaults for unset keys", async () => {
    await setSetting(db, SMTP_SETTING_KEYS.host, "smtp.example.com");
    await setSetting(db, SMTP_SETTING_KEYS.port, "465");
    await setSetting(db, SMTP_SETTING_KEYS.secure, "true");
    const cfg = await readSmtpConfig(db);
    expect(cfg.enabled).toBe(false);
    expect(cfg.host).toBe("smtp.example.com");
    expect(cfg.port).toBe(465);
    expect(cfg.secure).toBe(true);
    expect(cfg.username).toBe("");
    expect(cfg.fromAddress).toBe("");
  });

  test("falls back to 587 when the port is unset or malformed", async () => {
    await setSetting(db, SMTP_SETTING_KEYS.port, "not-a-port");
    expect((await readSmtpConfig(db)).port).toBe(587);
  });
});

describe("sendMail", () => {
  test("delivers through the configured SMTP server with the from-name and subject", async () => {
    const sink = await startSink();
    try {
      await configure(db, sink.port);
      const result = await sendMail(db, stubLogger, { to: "dest@example.com", subject: "Hello there", text: "Body line" });
      expect(result.status).toBe("sent");
      expect(sink.received).toHaveLength(1);
      expect(sink.received[0]!.from).toBe("noreply@example.com");
      expect(sink.received[0]!.to).toEqual(["dest@example.com"]);
      expect(sink.received[0]!.raw).toContain("Subject: Hello there");
      expect(sink.received[0]!.raw).toContain("Bit Notifier");
      expect(sink.received[0]!.raw).toContain("Body line");
    }
    finally {
      await sink.close();
    }
  });

  test("is skipped, not attempted, while smtp.enabled is not true", async () => {
    const sink = await startSink();
    try {
      await configure(db, sink.port, { [SMTP_SETTING_KEYS.enabled]: "false" });
      const result = await sendMail(db, stubLogger, { to: "dest@example.com", subject: "x", text: "y" });
      expect(result).toEqual({ status: "skipped", reason: "disabled" });
      expect(sink.received).toHaveLength(0);
    }
    finally {
      await sink.close();
    }
  });

  test("is skipped when enabled but the host or from address is missing", async () => {
    await setSetting(db, SMTP_SETTING_KEYS.enabled, "true");
    await setSetting(db, SMTP_SETTING_KEYS.host, "smtp.example.com");
    const result = await sendMail(db, stubLogger, { to: "dest@example.com", subject: "x", text: "y" });
    expect(result).toEqual({ status: "skipped", reason: "unconfigured" });
  });

  test("rejects when the server cannot be reached", async () => {
    const sink = await startSink();
    const port = sink.port;
    await sink.close(); // nothing listens here any more
    await configure(db, port);
    await expect(sendMail(db, stubLogger, { to: "dest@example.com", subject: "x", text: "y" }, { timeoutMs: 2_000 }))
      .rejects
      .toThrow();
  });
});
