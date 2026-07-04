import type { ApiResponse, ApiRow } from "./_generated";
import { http } from "@/shared/lib/http";

// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes. The
// admin per-user token routes share the /account/me/tokens shapes, so the
// `me` operations are the canonical source.
//
// Per-module scope levels. Mirrors the backend `TOKEN_MODULES` registry
// (`apps/api/src/modules/account/tokens/scope.ts`); the backend is the
// source of truth and re-validates every key on create.
export const TOKEN_SCOPE_MODULES = [
  "documents",
  "drive",
  "files",
  "projects",
  "ships",
  "contacts",
  "hr",
  "tags",
  "shares",
  "search",
  "account",
  "settings",
  "policy",
  "audit",
  "backup",
  "cron",
  "system",
] as const;

export type TokenScopeModule = typeof TOKEN_SCOPE_MODULES[number];

export const TOKEN_EXPIRY_OPTIONS = [7, 30, 90, 365] as const;

export type ApiTokenView = ApiRow<"getAccountMeTokens">;

export type ScopeLevel = ApiTokenView["scopes"][string];
// Scope INPUT map keyed by the frontend module registry (narrower than the
// spec's plain string-keyed record; assignable to the request body).
export type TokenScopeMap = Partial<Record<TokenScopeModule, ScopeLevel>>;

/** Includes the plaintext `token` secret — returned exactly once, at creation. */
export type CreatedApiToken = ApiResponse<"postAccountMeTokens", 201>["data"];

export interface CreateTokenInput {
  readonly name: string;
  readonly expiresInDays: number;
  readonly scopes: TokenScopeMap;
}

/** Whose tokens a panel acts on: the signed-in user, or (admin) a target user. */
export type TokenTarget = { readonly kind: "self" } | { readonly kind: "user"; readonly userId: string };

function basePath(target: TokenTarget): string {
  return target.kind === "self"
    ? "/account/me/tokens"
    : `/account/users/${encodeURIComponent(target.userId)}/tokens`;
}

export async function listTokens(target: TokenTarget): Promise<readonly ApiTokenView[]> {
  const res = await http<ApiResponse<"getAccountMeTokens">>(basePath(target));
  return res.data;
}

export async function createToken(target: TokenTarget, input: CreateTokenInput): Promise<CreatedApiToken> {
  const res = await http<ApiResponse<"postAccountMeTokens", 201>>(basePath(target), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function revokeToken(target: TokenTarget, id: string): Promise<void> {
  await http(`${basePath(target)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
