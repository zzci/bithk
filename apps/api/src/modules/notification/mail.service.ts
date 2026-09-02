import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import nodemailer from "nodemailer";
import { getSetting } from "@/modules/settings/settings.service";

/**
 * SMTP configuration lives in the settings table under these keys — the
 * admin SMTP tab writes them (FEAT-059); `smtp.password` is masked on read by
 * the settings module's `.password` suffix rule. Read fresh on every send:
 * the values are tiny, and reading them per call means an admin change takes
 * effect without a restart or a cache to invalidate.
 */
export const SMTP_SETTING_KEYS = {
  enabled: "smtp.enabled",
  host: "smtp.host",
  port: "smtp.port",
  /** `"true"` = implicit TLS (typically port 465); otherwise STARTTLS when offered. */
  secure: "smtp.secure",
  username: "smtp.username",
  password: "smtp.password",
  fromAddress: "smtp.from_address",
  fromName: "smtp.from_name",
} as const;

export interface SmtpConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
}

const DEFAULT_PORT = 587;
/** Per-phase socket budget so a black-holed relay cannot pin the queue. */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function readSmtpConfig(db: AppDatabase): Promise<SmtpConfig> {
  const [enabled, host, port, secure, username, password, fromAddress, fromName] = await Promise.all([
    getSetting(db, SMTP_SETTING_KEYS.enabled),
    getSetting(db, SMTP_SETTING_KEYS.host),
    getSetting(db, SMTP_SETTING_KEYS.port),
    getSetting(db, SMTP_SETTING_KEYS.secure),
    getSetting(db, SMTP_SETTING_KEYS.username),
    getSetting(db, SMTP_SETTING_KEYS.password),
    getSetting(db, SMTP_SETTING_KEYS.fromAddress),
    getSetting(db, SMTP_SETTING_KEYS.fromName),
  ]);
  const parsedPort = Number(port);
  return {
    enabled: enabled === "true",
    host: (host ?? "").trim(),
    port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
    secure: secure === "true",
    username: username ?? "",
    password: password ?? "",
    fromAddress: (fromAddress ?? "").trim(),
    fromName: (fromName ?? "").trim(),
  };
}

/** `true` when the config carries everything a send needs (host + from). */
export function smtpConfigComplete(cfg: SmtpConfig): boolean {
  return cfg.host !== "" && cfg.fromAddress !== "";
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export type SendMailResult
  = | { readonly status: "sent"; readonly messageId: string }
    | { readonly status: "skipped"; readonly reason: "disabled" | "unconfigured" };

export interface SendMailOptions {
  /** Connection / greeting / socket timeout per phase. Default 15 s. */
  readonly timeoutMs?: number | undefined;
}

/**
 * Send one plain-text message through the configured SMTP relay. Returns
 * `skipped` (never throws) while SMTP is disabled or incomplete so callers
 * can treat "no mail configured" as a no-op; a transport or delivery
 * failure rejects, and the caller decides whether that is a 502 (the admin
 * test send) or a logged drop (background notifications).
 */
export async function sendMail(
  db: AppDatabase,
  logger: Logger,
  message: MailMessage,
  opts: SendMailOptions = {},
): Promise<SendMailResult> {
  const cfg = await readSmtpConfig(db);
  if (!cfg.enabled)
    return { status: "skipped", reason: "disabled" };
  if (!smtpConfigComplete(cfg))
    return { status: "skipped", reason: "unconfigured" };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    ...(cfg.username ? { auth: { user: cfg.username, pass: cfg.password } } : {}),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  try {
    const info = await transport.sendMail({
      from: cfg.fromName ? { name: cfg.fromName, address: cfg.fromAddress } : cfg.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    logger.debug({ to: message.to, messageId: info.messageId }, "mail sent");
    return { status: "sent", messageId: info.messageId };
  }
  finally {
    transport.close();
  }
}
