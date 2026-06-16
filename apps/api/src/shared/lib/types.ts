import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { TokenScopeMap } from "@/modules/account/tokens/scope";
import type { users } from "@/modules/account/users/schema";
import type { Logger } from "@/shared/lib/logger";
import type { ModuleKey } from "@/shared/modules";

export type User = typeof users.$inferSelect;

export interface AppEnv {
  Bindings: {
    IP: { address: string; port: number; family: "IPv4" | "IPv6" } | null;
  };
  Variables: {
    requestId: string;
    db: AppDatabase;
    config: Config;
    logger: Logger;
    user?: User;
    /** Per-request cache of the actor's visible modules (module gate). */
    userModules?: readonly ModuleKey[];
    /**
     * Set only when the request authenticated via a Personal Access Token
     * (FEAT-034). Carries the token id + its per-module scope so
     * `apiTokenScopeGuard` can enforce the ceiling. Absent for cookie sessions.
     */
    apiToken?: { readonly id: string; readonly scopes: TokenScopeMap };
  };
}

/**
 * Env for routers mounted *after* `authRequired` has run. There the actor is
 * guaranteed to be present, so `Variables.user` is non-optional and
 * `c.get("user")` returns `User` directly — no `!` assertion needed.
 *
 * Used by protected route sub-apps (`new Hono<ProtectedEnv>()`). Mounting such
 * a sub-app onto the `Hono<AppEnv>` parent is type-compatible: `ProtectedEnv`
 * only narrows `user`, so a `ProtectedEnv` context is assignable to `AppEnv`.
 */
export interface ProtectedEnv {
  Bindings: AppEnv["Bindings"];
  Variables: Omit<AppEnv["Variables"], "user"> & { user: User };
}

/**
 * Structural constraint satisfied by both `AppEnv` and `ProtectedEnv` — any
 * Hono env carrying the standard request `Variables`. Hono's `Context<E>` is
 * invariant in `E` (its `set` accessor), so a helper annotated `Context<AppEnv>`
 * rejects a `Context<ProtectedEnv>` argument and vice-versa. Helpers that must
 * run under both routers instead take `Context<E>` for `E extends RequestEnv`:
 * inference binds `E` to the caller's exact env, so the same function serves
 * the optional-user (`AppEnv`) and guaranteed-user (`ProtectedEnv`) sides.
 */
export interface RequestEnv {
  Variables: AppEnv["Variables"];
}
