import type { AuthProvider } from "@/shared/middleware/auth-registry";
import { eq } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { isApiTokenSecret, parseScopes } from "./scope";
import { findActiveByHash, hashToken, touchLastUsed } from "./tokens.service";

const BEARER = "Bearer ";

/**
 * Resolve a request's Personal Access Token to its owning user. On a hit it
 * stashes the token id + parsed scope on the context so `apiTokenScopeGuard`
 * can enforce the per-module ceiling, and best-effort touches `lastUsedAt`.
 * Returns undefined for any non-PAT request so it can chain after the cookie
 * provider.
 */
export const apiTokenAuthProvider: AuthProvider = async (db, c) => {
  const authz = c.req.header("authorization");
  if (!authz?.startsWith(BEARER))
    return undefined;
  const supplied = authz.slice(BEARER.length).trim();
  if (!isApiTokenSecret(supplied))
    return undefined;

  const row = await findActiveByHash(db, hashToken(supplied));
  if (!row)
    return undefined;

  // Full user row (the cookie provider returns the same shape via the session
  // join); `getUserById` projects away `oauthSub`, which `User` requires.
  const user = await db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || user.status === "disabled")
    return undefined;

  c.set("apiToken", { id: row.id, scopes: parseScopes(row.scopes) });
  void touchLastUsed(db, row.id);
  return user;
};

/** Try each provider in order; first non-undefined user wins. */
export function chainAuthProviders(...providers: readonly AuthProvider[]): AuthProvider {
  return async (db, c) => {
    for (const provider of providers) {
      const user = await provider(db, c);
      if (user)
        return user;
    }
    return undefined;
  };
}
