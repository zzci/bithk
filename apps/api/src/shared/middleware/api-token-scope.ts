import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@/shared/lib/types";
import { isApiTokenSecret, levelForMethod, scopeSatisfies } from "@/modules/account/tokens/scope";
import { AppError } from "@/shared/lib/errors";
import { getAuthProvider } from "@/shared/middleware/auth-registry";
import { tokenModuleForPath } from "@/shared/module-manifest";

/**
 * Per-module ceiling for Personal Access Token requests (FEAT-034). Mounted on
 * the protected router after `moduleGate` so nav-module concealment (404) wins
 * over scope rejection (403) for modules the owner cannot see at all.
 *
 * Only requests carrying a `bithk_pat_…` bearer are gated; cookie and anonymous
 * requests pass straight through. The check runs regardless of the owner's role
 * (an admin's token is still bounded by its scope), and is an intersection on
 * top of `policyMiddleware` — it never grants access the policy engine denies.
 */
export function apiTokenScopeGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authz = c.req.header("authorization");
    if (!authz?.startsWith("Bearer ") || !isApiTokenSecret(authz.slice("Bearer ".length).trim()))
      return next();

    // Resolve the token (idempotent) if an upstream gate hasn't already.
    if (!c.get("apiToken")) {
      const user = await getAuthProvider()(c.get("db"), c);
      if (user)
        c.set("user", user);
    }
    const apiToken = c.get("apiToken");
    // Bearer present but not a live PAT → leave the 401 to `authRequired`.
    if (!apiToken)
      return next();

    const base = `${c.get("config").BASE_PATH}/api`;
    const path = c.req.path.startsWith(`${base}/`) ? c.req.path.slice(base.length) : c.req.path;

    // Identity probe is always allowed so a token can confirm who it is.
    if (c.req.method === "GET" && path === "/account/me")
      return next();

    const moduleKey = tokenModuleForPath(path);
    const need = levelForMethod(c.req.method);
    if (!moduleKey || !scopeSatisfies(apiToken.scopes[moduleKey], need)) {
      throw new AppError(
        `This token lacks ${need} access to "${moduleKey ?? "this resource"}".`,
        403,
        "TOKEN_SCOPE_INSUFFICIENT",
      );
    }
    return next();
  };
}
