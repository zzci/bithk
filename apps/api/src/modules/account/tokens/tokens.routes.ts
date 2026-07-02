import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { getUserById } from "@/modules/account/users/users.service";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
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

const idParamSchema = z.object({ id: z.string() });

// Public token-row view (mirrors `toView`); the plaintext `token` is present
// only on the create responses (returned exactly once).
const tokenViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.record(z.string(), z.enum(["read", "write"])),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  expired: z.boolean(),
});
const tokenWithSecretSchema = tokenViewSchema.extend({ token: z.string() });

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

export function tokenRoutes() {
  const router = new Hono<ProtectedEnv>();

  router.use("*", authRequired);

  // ── Self-service (acting on the caller's own tokens) ──

  router.get(
    "/account/me/tokens",
    describeRoute({
      tags: ["account"],
      summary: "List the caller's API tokens",
      responses: { 200: okJson(z.array(tokenViewSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Tokens cannot manage tokens", ...errorJson } },
    }),
    cookieSessionOnly,
    async (c) => {
      const rows = await listTokensForUser(c.get("db"), c.get("user").id);
      return c.json({ success: true, data: rows.map(toView) });
    },
  );

  router.post(
    "/account/me/tokens",
    describeRoute({
      tags: ["account"],
      summary: "Create an API token for the caller",
      responses: { 201: okJson(tokenWithSecretSchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Tokens cannot manage tokens", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    cookieSessionOnly,
    validator("json", createSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const actor = c.get("user");
      const body = c.req.valid("json");
      if (!isValidScopeInput(body.scopes))
        throw new ValidationError("Unknown token scope module or level", { scopes: body.scopes });
      const { token, row } = await createToken(db, {
        userId: actor.id,
        name: body.name,
        scopes: body.scopes,
        expiresInDays: body.expiresInDays,
      });
      await auditFromCtx(c, {
        action: "api_token.created",
        resourceType: "api_token",
        resourceId: row.id,
        resourceName: row.name,
        detail: { targetUserId: actor.id, scopes: body.scopes, expiresAt: row.expiresAt },
        result: "success",
      });
      // `token` (plaintext) is returned exactly once.
      return c.json({ success: true, data: { ...toView(row), token } }, 201);
    },
  );

  router.delete(
    "/account/me/tokens/:id",
    describeRoute({
      tags: ["account"],
      summary: "Revoke one of the caller's API tokens",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Tokens cannot manage tokens", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    cookieSessionOnly,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const actor = c.get("user");
      const { id } = c.req.valid("param");
      const row = await getTokenByIdForUser(db, actor.id, id);
      if (!row)
        throw new NotFoundError("API token", id);
      await revokeToken(db, id);
      await auditFromCtx(c, {
        action: "api_token.revoked",
        resourceType: "api_token",
        resourceId: id,
        resourceName: row.name,
        detail: { targetUserId: actor.id },
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ── Admin (acting on another user's tokens; the only way to mint for a
  //    virtual user, who cannot log in). ──

  router.get(
    "/account/users/:id/tokens",
    describeRoute({
      tags: ["account"],
      summary: "List a user's API tokens (admin)",
      responses: { 200: okJson(z.array(tokenViewSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    cookieSessionOnly,
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: userId } = c.req.valid("param");
      const target = await getUserById(db, userId);
      if (!target)
        throw new NotFoundError("User", userId);
      const rows = await listTokensForUser(db, userId);
      return c.json({ success: true, data: rows.map(toView) });
    },
  );

  router.post(
    "/account/users/:id/tokens",
    describeRoute({
      tags: ["account"],
      summary: "Mint an API token for a user (admin)",
      responses: { 201: okJson(tokenWithSecretSchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    cookieSessionOnly,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", createSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: userId } = c.req.valid("param");
      const target = await getUserById(db, userId);
      if (!target)
        throw new NotFoundError("User", userId);
      const body = c.req.valid("json");
      if (!isValidScopeInput(body.scopes))
        throw new ValidationError("Unknown token scope module or level", { scopes: body.scopes });
      const { token, row } = await createToken(db, {
        userId,
        name: body.name,
        scopes: body.scopes,
        expiresInDays: body.expiresInDays,
      });
      await auditFromCtx(c, {
        action: "api_token.created",
        resourceType: "api_token",
        resourceId: row.id,
        resourceName: row.name,
        detail: { targetUserId: userId, scopes: body.scopes, expiresAt: row.expiresAt },
        result: "success",
      });
      return c.json({ success: true, data: { ...toView(row), token } }, 201);
    },
  );

  router.delete(
    "/account/users/:id/tokens/:tokenId",
    describeRoute({
      tags: ["account"],
      summary: "Revoke a user's API token (admin)",
      responses: { 200: okJson(z.null()), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    cookieSessionOnly,
    validator("param", z.object({ id: z.string(), tokenId: z.string() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id: userId, tokenId } = c.req.valid("param");
      const row = await getTokenByIdForUser(db, userId, tokenId);
      if (!row)
        throw new NotFoundError("API token", tokenId);
      await revokeToken(db, tokenId);
      await auditFromCtx(c, {
        action: "api_token.revoked",
        resourceType: "api_token",
        resourceId: tokenId,
        resourceName: row.name,
        detail: { targetUserId: userId },
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
