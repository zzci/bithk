import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SMTPServer } from "smtp-server";
import { createDb } from "@/db";
import { setSetting } from "@/modules/settings/settings.service";
import { __mailQueueIdle, __resetMailQueueForTests, enqueueMail } from "./mail.queue";
import { SMTP_SETTING_KEYS } from "./mail.service";

function recordingLogger(calls: { level: string; msg: string }[]): Logger {
  const record = (level: string) => (_ctx: unknown, msg: string) => calls.push({ level, msg });
  return { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error"), fatal: record("fatal"), flush: () => {}, reopen: () => {} } as unknown as Logger;
}

async function startSink(): Promise<{ port: number; subjects: string[]; close: () => Promise<void> }> {
  const subjects: string[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["AUTH", "STARTTLS"],
    onData(stream, _session, callback) {
      let raw = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        raw += chunk;
      });
      stream.on("end", () => {
        subjects.push(/^Subject: (.*)$/m.exec(raw)?.[1] ?? "");
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
  return { port, subjects, close: () => new Promise<void>(done => server.close(() => done())) };
}

let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "mail-queue-"));
  db = await createDb(resolve(dir, "app.db"));
  __resetMailQueueForTests();
});

afterEach(() => {
  __resetMailQueueForTests();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function enable(port: number): Promise<void> {
  await setSetting(db, SMTP_SETTING_KEYS.enabled, "true");
  await setSetting(db, SMTP_SETTING_KEYS.host, "127.0.0.1");
  await setSetting(db, SMTP_SETTING_KEYS.port, String(port));
  await setSetting(db, SMTP_SETTING_KEYS.fromAddress, "noreply@example.com");
}

describe("mail queue", () => {
  test("delivers queued messages one after another, in order", async () => {
    const sink = await startSink();
    try {
      await enable(sink.port);
      const calls: { level: string; msg: string }[] = [];
      const logger = recordingLogger(calls);
      enqueueMail(db, logger, { to: "a@example.com", subject: "first", text: "1" });
      enqueueMail(db, logger, { to: "b@example.com", subject: "second", text: "2" });
      await __mailQueueIdle();
      expect(sink.subjects).toEqual(["first", "second"]);
      expect(calls.some(c => c.level === "warn")).toBe(false);
    }
    finally {
      await sink.close();
    }
  });

  test("a failed delivery is logged and does not stop later messages", async () => {
    const sink = await startSink();
    try {
      await enable(sink.port);
      const calls: { level: string; msg: string }[] = [];
      const logger = recordingLogger(calls);
      // First message: bogus recipient the sink rejects? Keep it simple — an
      // unreachable relay for one message via a per-message host override is
      // not part of the API, so simulate failure with an invalid address.
      enqueueMail(db, logger, { to: "not-an-address", subject: "broken", text: "x" });
      enqueueMail(db, logger, { to: "ok@example.com", subject: "fine", text: "y" });
      await __mailQueueIdle();
      expect(sink.subjects).toContain("fine");
      expect(calls.some(c => c.level === "warn" && c.msg === "notification mail failed")).toBe(true);
    }
    finally {
      await sink.close();
    }
  });

  test("is a silent no-op while SMTP is disabled", async () => {
    const calls: { level: string; msg: string }[] = [];
    enqueueMail(db, recordingLogger(calls), { to: "a@example.com", subject: "x", text: "y" });
    await __mailQueueIdle();
    expect(calls.some(c => c.level === "warn")).toBe(false);
  });
});
