import { http } from "@/shared/lib/http";

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
export type ScopeLevel = "read" | "write";
export type TokenScopeMap = Partial<Record<TokenScopeModule, ScopeLevel>>;

export const TOKEN_EXPIRY_OPTIONS = [7, 30, 90, 365] as const;

export interface ApiTokenView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: TokenScopeMap;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly expired: boolean;
}

export interface CreatedApiToken extends ApiTokenView {
  /** Plaintext secret — returned exactly once, at creation. */
  readonly token: string;
}

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

export async function listTokens(target: TokenTarget): Promise<ApiTokenView[]> {
  const res = await http<{ success: boolean; data: ApiTokenView[] }>(basePath(target));
  return res.data;
}

export async function createToken(target: TokenTarget, input: CreateTokenInput): Promise<CreatedApiToken> {
  const res = await http<{ success: boolean; data: CreatedApiToken }>(basePath(target), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function revokeToken(target: TokenTarget, id: string): Promise<void> {
  await http(`${basePath(target)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
