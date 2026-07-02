import type { Context } from "hono";
import type { AuditOptions, AuditParams } from "@/modules/audit/audit.service";
import type { RequestEnv } from "@/shared/lib/types";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";

/**
 * `audit()` entry as written at a route handler: the request-derived fields
 * (db, logger, ip, userAgent) come from the context, and the actor defaults
 * to the authenticated user. Handlers auditing on behalf of someone else
 * (login flows, public share hits) override `actorId`/`actorName` explicitly.
 */
export type AuditCtxEntry = Omit<AuditParams, "actorId" | "actorName" | "ip" | "userAgent"> & {
  readonly actorId?: string;
  readonly actorName?: string;
  readonly ip?: string;
  readonly userAgent?: string;
};

/**
 * Persist an audit event from a route handler, deriving the boilerplate
 * (actor, ip, user-agent, db, logger) from the Hono context instead of
 * repeating it at every call site. The ip is resolved through the app config
 * so `TRUST_PROXY` deployments record the real client address everywhere.
 *
 * Generic over `RequestEnv` so it serves both `AppEnv` (optional user — the
 * caller must then pass an explicit actor) and `ProtectedEnv` handlers.
 */
export async function auditFromCtx<E extends RequestEnv>(
  c: Context<E>,
  entry: AuditCtxEntry,
  options: AuditOptions = {},
): Promise<string | undefined> {
  const { actorId, actorName, ip, userAgent, ...rest } = entry;
  const user = c.get("user");
  return audit(c.get("db"), c.get("logger"), {
    actorId: actorId ?? user?.id ?? "unknown",
    actorName: actorName ?? user?.name ?? "unknown",
    ip: ip ?? getClientIp(c, c.get("config")),
    userAgent: userAgent ?? c.req.header("user-agent") ?? "unknown",
    ...rest,
  }, options);
}
