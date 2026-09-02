import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, okListJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { optionalPageQueryFields } from "@/shared/lib/pagination";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { readSmtpConfig, sendMail, smtpConfigComplete } from "./mail.service";
import { WEBHOOK_DELIVERY_STATUSES } from "./schema";
import { enqueueTest } from "./webhook.dispatcher";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  updateWebhook,
  validateWebhookUrl,
} from "./webhook.service";

const smtpTestResultSchema = z.object({ to: z.string(), messageId: z.string() });

/** Bound the admin test send tighter than background mail: it is interactive. */
const TEST_SEND_TIMEOUT_MS = 10_000;

// ─── Webhook schemas ───────────────────────────────────────────────────
const eventsSchema = z.array(z.string().trim().min(1).max(100)).min(1).max(50);
const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2048),
  secret: z.string().max(256).optional(),
  events: eventsSchema,
  enabled: z.boolean().optional(),
});
// `secret: null` clears the saved key; omitted keeps it.
const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  secret: z.string().max(256).nullable().optional(),
  events: eventsSchema.optional(),
  enabled: z.boolean().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });
const webhookIdParam = z.object({ id: z.string() });
const deliveriesQuerySchema = z.object({ ...optionalPageQueryFields(100) });

const webhookViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  hasSecret: z.boolean(),
  consecutiveFailures: z.number(),
  lastDeliveryAt: z.string().nullable(),
  lastDeliveryStatus: z.enum(WEBHOOK_DELIVERY_STATUSES).nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const deliveryViewSchema = z.object({
  id: z.string(),
  event: z.string(),
  eventId: z.string(),
  payload: z.string(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES),
  attempts: z.number(),
  responseStatus: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
const adminErrors = {
  401: { description: "Unauthenticated", ...errorJson },
  403: { description: "Admin only", ...errorJson },
} as const;

/**
 * Admin notification routes (FEAT-059 / FEAT-060). SMTP settings themselves
 * are plain `smtp.*` rows written through the generic settings CRUD; this
 * router adds the action that proves them, plus the webhook subscription
 * CRUD, the test ping and the delivery log.
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
        ...adminErrors,
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

  // ─── Webhooks (FEAT-060) ─────────────────────────────────────────────

  router.get(
    "/admin/webhooks",
    describeRoute({ tags: ["infra1"], summary: "List webhook subscriptions", responses: { 200: okJson(z.array(webhookViewSchema)), ...adminErrors } }),
    adminRequired,
    async c => c.json({ success: true, data: await listWebhooks(c.get("db")) }),
  );

  router.post(
    "/admin/webhooks",
    describeRoute({
      tags: ["infra1"],
      summary: "Create a webhook subscription",
      responses: { 201: okJson(webhookViewSchema, "Created"), 400: { description: "URL refused", ...errorJson }, ...adminErrors, 409: { description: "Name already used", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createWebhookSchema, onValidationFailure),
    async (c) => {
      const body = c.req.valid("json");
      await validateWebhookUrl(c.get("config"), body.url);
      const view = await createWebhook(c.get("db"), { ...body, createdBy: c.get("user").id });
      await auditFromCtx(c, {
        action: "webhook.created",
        resourceType: "webhook",
        resourceId: view.id,
        resourceName: view.name,
        detail: { url: view.url, events: view.events, hasSecret: view.hasSecret, enabled: view.enabled },
        result: "success",
      });
      return c.json({ success: true, data: view }, 201);
    },
  );

  router.get(
    "/admin/webhooks/:id",
    describeRoute({ tags: ["infra1"], summary: "Get a webhook subscription", responses: { 200: okJson(webhookViewSchema), ...adminErrors, 404: { description: "Not found", ...errorJson } } }),
    adminRequired,
    validator("param", webhookIdParam, onValidationFailure),
    async (c) => {
      const view = await getWebhook(c.get("db"), c.req.valid("param").id);
      if (!view)
        throw new NotFoundError("Webhook", c.req.valid("param").id);
      return c.json({ success: true, data: view });
    },
  );

  router.patch(
    "/admin/webhooks/:id",
    describeRoute({
      tags: ["infra1"],
      summary: "Update a webhook subscription",
      responses: { 200: okJson(webhookViewSchema), 400: { description: "URL refused", ...errorJson }, ...adminErrors, 404: { description: "Not found", ...errorJson }, 409: { description: "Name already used", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", webhookIdParam, onValidationFailure),
    validator("json", updateWebhookSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      if (body.url !== undefined)
        await validateWebhookUrl(c.get("config"), body.url);
      const view = await updateWebhook(c.get("db"), id, body);
      if (!view)
        throw new NotFoundError("Webhook", id);
      await auditFromCtx(c, {
        action: "webhook.updated",
        resourceType: "webhook",
        resourceId: view.id,
        resourceName: view.name,
        detail: {
          fields: Object.keys(body).filter(k => k !== "secret"),
          secretChanged: body.secret !== undefined,
          enabled: view.enabled,
        },
        result: "success",
      });
      return c.json({ success: true, data: view });
    },
  );

  router.delete(
    "/admin/webhooks/:id",
    describeRoute({ tags: ["infra1"], summary: "Delete a webhook subscription and its delivery log", responses: { 200: okJson(z.null()), ...adminErrors, 404: { description: "Not found", ...errorJson } } }),
    adminRequired,
    validator("param", webhookIdParam, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const view = await getWebhook(c.get("db"), id);
      if (!view || !(await deleteWebhook(c.get("db"), id)))
        throw new NotFoundError("Webhook", id);
      await auditFromCtx(c, {
        action: "webhook.deleted",
        resourceType: "webhook",
        resourceId: view.id,
        resourceName: view.name,
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  router.post(
    "/admin/webhooks/:id/test",
    describeRoute({
      tags: ["infra1"],
      summary: "Queue a webhook.test delivery to the endpoint",
      description: "Answers 202 as soon as the delivery row exists; poll the deliveries log for the outcome.",
      responses: { 202: okJson(z.object({ deliveryId: z.string() }), "Queued"), ...adminErrors, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", webhookIdParam, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const view = await getWebhook(c.get("db"), id);
      if (!view)
        throw new NotFoundError("Webhook", id);
      const user = c.get("user");
      const deliveryId = await enqueueTest({ db: c.get("db"), logger: c.get("logger"), config: c.get("config") }, id, { id: user.id, name: user.name });
      await auditFromCtx(c, {
        action: "webhook.tested",
        resourceType: "webhook",
        resourceId: view.id,
        resourceName: view.name,
        detail: { deliveryId },
        result: "success",
      });
      return c.json({ success: true, data: { deliveryId } }, 202);
    },
  );

  router.get(
    "/admin/webhooks/:id/deliveries",
    describeRoute({ tags: ["infra1"], summary: "List a webhook's recent deliveries (newest first)", responses: { 200: okListJson(deliveryViewSchema), ...adminErrors, 404: { description: "Not found", ...errorJson } } }),
    adminRequired,
    validator("param", webhookIdParam, onValidationFailure),
    validator("query", deliveriesQuerySchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      if (!(await getWebhook(c.get("db"), id)))
        throw new NotFoundError("Webhook", id);
      const { page: pageRaw, limit: limitRaw } = c.req.valid("query");
      const page = pageRaw ?? 1;
      const limit = limitRaw ?? 20;
      const result = await listDeliveries(c.get("db"), id, { page, limit });
      return c.json({ success: true, data: result.data, meta: { total: result.total, page, limit } });
    },
  );

  return router;
}
