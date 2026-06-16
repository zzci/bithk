import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { getUserById } from "@/modules/account/users/users.service";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { isValidScopeInput, parseScopes } from "./scope";
import {
  createToken,
  getTokenByIdForUser,
  listTokensForUser,
  MAX_EXPIRY_DAYS,
  revokeToken,
} from "./tokens.service";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS),
  scopes: z.record(z.string(), z.enum(["read", "write"])).optional().default({}),
});

// Token management is a session-only surface: a PAT must not be able to mint,
// list, or revoke tokens (no token-farming / privilege escalation). Cookie
// sessions have no `apiToken` on the context.
const cookieSessionOnly = createMiddleware<ProtectedEnv>(async (c, next) => {
  if (c.get("apiToken"))
    throw new ForbiddenError("Personal access tokens cannot manage tokens; use a browser session.");
  return next();
});

/** Public shape for a token row — never leaks the hash. */
function toView(row: {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    expired: row.revokedAt == null && row.expiresAt <= new Date().toISOString(),
  };
}

function parseCreateBody(raw: unknown) {
  const body = createSchema.parse(raw);
  if (!isValidScopeInput(body.scopes))
    throw new ValidationError("Unknown token scope module or level", { scopes: body.scopes });
  return body;
}

export function tokenRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // ── Self-service (acting on the caller's own tokens) ──

  router.get("/account/me/tokens", cookieSessionOnly, async (c) => {
    const rows = await listTokensForUser(c.get("db"), c.get("user").id);
    return c.json({ success: true, data: rows.map(toView) });
  });

  router.post("/account/me/tokens", cookieSessionOnly, async (c) => {
    const db = c.get("db");
    const actor = c.get("user");
    const body = parseCreateBody(await c.req.json());
    const { token, row } = await createToken(db, {
      userId: actor.id,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });
    await audit(db, c.get("logger"), {
      actorId: actor.id,
      actorName: actor.name,
      action: "api_token.created",
      resourceType: "api_token",
      resourceId: row.id,
      resourceName: row.name,
      detail: { targetUserId: actor.id, scopes: body.scopes, expiresAt: row.expiresAt },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });
    // `token` (plaintext) is returned exactly once.
    return c.json({ success: true, data: { ...toView(row), token } }, 201);
  });

  router.delete("/account/me/tokens/:id", cookieSessionOnly, async (c) => {
    const db = c.get("db");
    const actor = c.get("user");
    const id = c.req.param("id");
    const row = await getTokenByIdForUser(db, actor.id, id);
    if (!row)
      throw new NotFoundError("API token", id);
    await revokeToken(db, id);
    await audit(db, c.get("logger"), {
      actorId: actor.id,
      actorName: actor.name,
      action: "api_token.revoked",
      resourceType: "api_token",
      resourceId: id,
      resourceName: row.name,
      detail: { targetUserId: actor.id },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  // ── Admin (acting on another user's tokens; the only way to mint for a
  //    virtual user, who cannot log in). ──

  router.get("/account/users/:id/tokens", adminRequired, cookieSessionOnly, async (c) => {
    const db = c.get("db");
    const userId = c.req.param("id");
    const target = await getUserById(db, userId);
    if (!target)
      throw new NotFoundError("User", userId);
    const rows = await listTokensForUser(db, userId);
    return c.json({ success: true, data: rows.map(toView) });
  });

  router.post("/account/users/:id/tokens", adminRequired, cookieSessionOnly, async (c) => {
    const db = c.get("db");
    const actor = c.get("user");
    const userId = c.req.param("id");
    const target = await getUserById(db, userId);
    if (!target)
      throw new NotFoundError("User", userId);
    const body = parseCreateBody(await c.req.json());
    const { token, row } = await createToken(db, {
      userId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });
    await audit(db, c.get("logger"), {
      actorId: actor.id,
      actorName: actor.name,
      action: "api_token.created",
      resourceType: "api_token",
      resourceId: row.id,
      resourceName: row.name,
      detail: { targetUserId: userId, scopes: body.scopes, expiresAt: row.expiresAt },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });
    return c.json({ success: true, data: { ...toView(row), token } }, 201);
  });

  router.delete("/account/users/:id/tokens/:tokenId", adminRequired, cookieSessionOnly, async (c) => {
    const db = c.get("db");
    const actor = c.get("user");
    const userId = c.req.param("id");
    const tokenId = c.req.param("tokenId");
    const row = await getTokenByIdForUser(db, userId, tokenId);
    if (!row)
      throw new NotFoundError("API token", tokenId);
    await revokeToken(db, tokenId);
    await audit(db, c.get("logger"), {
      actorId: actor.id,
      actorName: actor.name,
      action: "api_token.revoked",
      resourceType: "api_token",
      resourceId: tokenId,
      resourceName: row.name,
      detail: { targetUserId: userId },
      ip: getClientIp(c),
      userAgent: c.req.header("user-agent") ?? "unknown",
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  return router;
}
