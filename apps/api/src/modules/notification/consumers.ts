import type { MailMessage } from "./mail.service";
import type { AppDatabase } from "@/db";
import type { AuditEvent } from "@/modules/audit/audit.service";
import { eq } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { onAuditEvent } from "@/modules/audit/audit.service";
import { projectMembers, projects } from "@/modules/project/schema";
import { enqueueMail } from "./mail.queue";

/**
 * Notification emails (FEAT-059) are derived from the audit stream: every
 * mutating route already lands an `audit_events` row through `audit()`, so
 * subscribing there gives one event source without any route knowing about
 * mail. Each consumer turns one audit action into at most one message;
 * anything it cannot resolve (public links, virtual / disabled / email-less
 * recipients, self-assignment) is a silent no-op — the audit row is the
 * record, the email is a courtesy.
 */
export interface NotificationLinkConfig {
  readonly APP_URL?: string | undefined;
  readonly BASE_PATH: string;
}

const RE_TRAILING_SLASHES = /\/+$/;

/** `APP_URL` (trailing slash trimmed) + `BASE_PATH`; empty when APP_URL is unset. */
export function appBaseUrl(config: NotificationLinkConfig): string {
  return `${(config.APP_URL ?? "").replace(RE_TRAILING_SLASHES, "")}${config.BASE_PATH}`;
}

interface Recipient {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** A real, active user with an address — virtual staff carry synthetic emails. */
async function loadRecipient(db: AppDatabase, userId: string): Promise<Recipient | null> {
  const row = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, isVirtual: users.isVirtual })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row || row.isVirtual || row.status !== "active")
    return null;
  const email = row.email.trim();
  if (!email || !email.includes("@"))
    return null;
  return { id: row.id, name: row.name, email };
}

function detailString(event: AuditEvent, key: string): string | null {
  const value = event.detail?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

async function shareCreated(db: AppDatabase, event: AuditEvent, config: NotificationLinkConfig): Promise<MailMessage | null> {
  if (event.result !== "success" || detailString(event, "shareType") !== "direct")
    return null;
  const userId = detailString(event, "sharedWithUserId");
  if (!userId)
    return null;
  const recipient = await loadRecipient(db, userId);
  if (!recipient || recipient.id === event.actorId)
    return null;

  const base = appBaseUrl(config);
  const resourceId = detailString(event, "resourceId");
  const link = detailString(event, "resourceType") === "document" && resourceId
    ? `${base}/documents/${resourceId}`
    : `${base}/drive`;
  const name = event.resourceName;
  return {
    to: recipient.email,
    subject: `${event.actorName} shared "${name}" with you · ${event.actorName} 与你分享了「${name}」`,
    text: [
      `${event.actorName} shared "${name}" with you.`,
      `${event.actorName} 与你分享了「${name}」。`,
      "",
      link,
    ].join("\n"),
  };
}

async function issueAssigned(db: AppDatabase, event: AuditEvent, config: NotificationLinkConfig): Promise<MailMessage | null> {
  if (event.result !== "success")
    return null;
  const memberId = detailString(event, "to");
  if (!memberId)
    return null;
  const member = await db
    .select({ userId: projectMembers.userId, projectShortId: projects.shortId, projectName: projects.name })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.id, memberId))
    .get();
  if (!member)
    return null;
  const recipient = await loadRecipient(db, member.userId);
  if (!recipient || recipient.id === event.actorId)
    return null;

  const link = `${appBaseUrl(config)}/projects/${member.projectShortId}/issues/${event.resourceId}`;
  const title = event.resourceName;
  return {
    to: recipient.email,
    subject: `Work order assigned to you: ${title} · 工单已指派给你：${title}`,
    text: [
      `${event.actorName} assigned the work order "${title}" in project ${member.projectName} to you.`,
      `${event.actorName} 将项目「${member.projectName}」的工单「${title}」指派给了你。`,
      "",
      link,
    ].join("\n"),
  };
}

/** The message an audit event should produce, or `null` when it warrants none. */
export async function buildNotificationMail(
  db: AppDatabase,
  event: AuditEvent,
  config: NotificationLinkConfig,
): Promise<MailMessage | null> {
  switch (event.action) {
    case "share.created":
      return shareCreated(db, event, config);
    case "issue.assigned":
      return issueAssigned(db, event, config);
    default:
      return null;
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Subscribe the notification consumers to the audit stream. Idempotent per
 * process: a second call (another `buildFullApp`, e.g. in tests) replaces
 * the previous subscription instead of stacking listeners.
 */
export function startNotificationConsumers(config: NotificationLinkConfig): void {
  unsubscribe?.();
  unsubscribe = onAuditEvent(async (event, ctx) => {
    const mail = await buildNotificationMail(ctx.db, event, config);
    if (mail)
      enqueueMail(ctx.db, ctx.logger, mail);
  });
}

export function stopNotificationConsumers(): void {
  unsubscribe?.();
  unsubscribe = null;
}
