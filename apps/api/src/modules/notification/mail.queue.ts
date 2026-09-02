import type { MailMessage } from "./mail.service";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { sendMail } from "./mail.service";

interface QueuedMail {
  readonly db: AppDatabase;
  readonly logger: Logger;
  readonly message: MailMessage;
}

// Serial in-process mail queue (FEAT-059). Notification consumers hand mail
// here from the audit listener so the triggering request never waits on the
// relay; one send runs at a time (an internal SMTP relay is not a fan-out
// target) and a failure is logged and dropped — the audit row is the record,
// the email is best-effort. Process-local: mail pending at shutdown is lost
// after `stopMailQueue()` drains the in-flight send.
const pending: QueuedMail[] = [];
let draining: Promise<void> | null = null;

async function drain(): Promise<void> {
  while (pending.length > 0) {
    const item = pending.shift()!;
    try {
      const result = await sendMail(item.db, item.logger, item.message);
      if (result.status === "skipped")
        item.logger.debug({ to: item.message.to, reason: result.reason }, "notification mail skipped");
    }
    catch (err) {
      item.logger.warn({ err, to: item.message.to, subject: item.message.subject }, "notification mail failed");
    }
  }
  draining = null;
}

/** Queue a message; returns immediately. Never throws. */
export function enqueueMail(db: AppDatabase, logger: Logger, message: MailMessage): void {
  pending.push({ db, logger, message });
  if (!draining)
    draining = drain();
}

/** Shutdown hook: drop queued mail, wait for the send in flight. */
export async function stopMailQueue(): Promise<void> {
  pending.length = 0;
  if (draining)
    await draining;
}

/** Test hook: resolves once the queue has fully drained. */
export function __mailQueueIdle(): Promise<void> {
  return draining ?? Promise.resolve();
}

export function __resetMailQueueForTests(): void {
  pending.length = 0;
  draining = null;
}
