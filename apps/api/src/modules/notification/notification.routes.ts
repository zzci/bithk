import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { AppError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { readSmtpConfig, sendMail, smtpConfigComplete } from "./mail.service";

const smtpTestResultSchema = z.object({ to: z.string(), messageId: z.string() });

/** Bound the admin test send tighter than background mail: it is interactive. */
const TEST_SEND_TIMEOUT_MS = 10_000;

/**
 * Admin notification routes (FEAT-059). SMTP settings themselves are plain
 * `smtp.*` rows written through the generic settings CRUD; this router only
 * adds the action that proves them.
 */
export function notificationRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // POST /admin/smtp/test — send a test message to the calling admin.
  router.post(
    "/admin/smtp/test",
    describeRoute({
      tags: ["infra1"],
      summary: "Send a test email to the calling admin through the configured SMTP relay",
      responses: {
        200: okJson(smtpTestResultSchema),
        400: { description: "Calling account has no email address", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
        409: { description: "SMTP disabled or incomplete", ...errorJson },
        502: { description: "Relay rejected or unreachable", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const cfg = await readSmtpConfig(db);
      if (!cfg.enabled)
        throw new AppError("SMTP is disabled", 409, "SMTP_DISABLED");
      if (!smtpConfigComplete(cfg))
        throw new AppError("SMTP needs at least a host and a from address", 409, "SMTP_UNCONFIGURED");
      const to = user.email.trim();
      if (!to)
        throw new AppError("Your account has no email address to send to", 400, "NO_EMAIL");

      let messageId: string;
      try {
        const result = await sendMail(db, c.get("logger"), {
          to,
          subject: "SMTP test message · SMTP 测试邮件",
          text: [
            "This is a test message; your SMTP settings deliver mail.",
            "这是一封测试邮件，说明 SMTP 配置可以正常发信。",
          ].join("\n"),
        }, { timeoutMs: TEST_SEND_TIMEOUT_MS });
        // `skipped` cannot happen past the two guards above, but keep the
        // exhaustive branch so a future reason surfaces instead of vanishing.
        if (result.status !== "sent")
          throw new AppError(`SMTP send skipped (${result.reason})`, 409, "SMTP_UNCONFIGURED");
        messageId = result.messageId;
      }
      catch (err) {
        if (err instanceof AppError)
          throw err;
        // The transport error names hosts and ports; keep it in the log and
        // hand the client a generic message.
        c.get("logger").warn({ err, to, host: cfg.host, port: cfg.port }, "smtp test send failed");
        await auditFromCtx(c, {
          action: "smtp.test",
          resourceType: "smtp",
          resourceId: "config",
          resourceName: "smtp",
          detail: { to },
          result: "failure",
        });
        throw new AppError("SMTP delivery failed; check the server logs for details", 502, "SMTP_SEND_FAILED");
      }

      await auditFromCtx(c, {
        action: "smtp.test",
        resourceType: "smtp",
        resourceId: "config",
        resourceName: "smtp",
        detail: { to, messageId },
        result: "success",
      });
      return c.json({ success: true, data: { to, messageId } });
    },
  );

  return router;
}
