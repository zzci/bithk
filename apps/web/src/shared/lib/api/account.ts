// Account admin data layer: users (real + virtual) and groups, mirroring the
// backend account module (apps/api/src/modules/account). The paginated users
// list is a TanStack Query hook; the group management page still coordinates
// its selection/member state imperatively (24 useState — the react-query
// adoption is tracked with the UI-029 god-component split), so group requests
// are exposed as typed functions.

import type { ApiData, ApiResponse, ApiRow } from "./_generated";
import type { ModuleKey } from "@/shared/lib/modules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (inputs, query params) stay hand-written below.

// TODO(spec): missing in OpenAPI spec — backend describeRoute bug. The GET
// /account/users handler attaches `groups` to every row (users.service
// listUsers) but documents only `userColumnsSchema`.
export interface AccountUserGroupRef {
  readonly id: string;
  readonly name: string;
}

// User row from GET /account/users, plus the runtime-only `groups`.
// TODO(spec): `groups` missing in OpenAPI spec — backend describeRoute bug.
export type AccountUser = ApiRow<"getAccountUsers"> & {
  readonly groups?: readonly AccountUserGroupRef[];
};

// TODO(spec): missing in OpenAPI spec — backend describeRoute bug. The GET
// /account/users handler returns `meta: { total, page, limit, totalPages }`
// (pagination the users table relies on) but documents only the data array.
export interface AccountUsersMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface AccountUsersResult {
  readonly data: readonly AccountUser[];
  readonly meta: AccountUsersMeta;
}

type AccountUsersResponse = Omit<ApiResponse<"getAccountUsers">, "data"> & {
  readonly data: readonly AccountUser[];
  readonly meta: AccountUsersMeta;
};

export type AccountGroup = ApiRow<"getAccountGroups">;

export type AccountGroupMember = ApiRow<"getAccountGroupsByIdMembers">;

// The `{ modules }` payload of the built-in Default group endpoints.
type DefaultGroupModules = ApiData<"getAccountGroupsDefault">["modules"];

// ── Query keys ──

export const accountKeys = {
  usersRoot: ["account", "users"] as const,
  users: (q: string, role: string, status: string, page: number, limit: number) =>
    ["account", "users", q, role, status, page, limit] as const,
};

// ── Users ──

export interface AccountUsersQuery {
  readonly q?: string | undefined;
  readonly role?: string | undefined;
  readonly status?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

function usersQueryString(query: AccountUsersQuery): string {
  const params = new URLSearchParams();
  if (query.q)
    params.set("q", query.q);
  if (query.role)
    params.set("role", query.role);
  if (query.status)
    params.set("status", query.status);
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? 20));
  return params.toString();
}

export async function listAccountUsers(query: AccountUsersQuery = {}): Promise<AccountUsersResult> {
  const res = await http<AccountUsersResponse>(`/account/users?${usersQueryString(query)}`);
  return { data: res.data, meta: res.meta };
}

export function useAccountUsers(query: AccountUsersQuery = {}) {
  return useQuery<AccountUsersResult>({
    queryKey: accountKeys.users(query.q ?? "", query.role ?? "", query.status ?? "", query.page ?? 1, query.limit ?? 20),
    queryFn: () => listAccountUsers(query),
    // Keep the prior page/filter rows on screen while the next query loads so
    // the users table does not flash empty on page or filter changes.
    placeholderData: keepPreviousData,
  });
}

export interface CreateAccountUserInput {
  readonly username: string;
  readonly name: string;
  readonly email?: string;
}

export async function createAccountUser(body: CreateAccountUserInput): Promise<void> {
  await http("/account/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface UpdateAccountUserInput {
  readonly username?: string;
  readonly name?: string;
  readonly email?: string;
  readonly role?: "admin" | "user";
  readonly status?: "active" | "disabled";
}

export async function updateAccountUser(id: string, body: UpdateAccountUserInput): Promise<void> {
  await http(`/account/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAccountUser(id: string): Promise<void> {
  await http(`/account/users/${id}`, { method: "DELETE" });
}

// ── Groups ──

export async function listAccountGroups(): Promise<readonly AccountGroup[]> {
  const res = await http<ApiResponse<"getAccountGroups">>("/account/groups");
  return res.data;
}

export interface AccountGroupInput {
  readonly name: string;
  readonly description?: string | undefined;
  readonly modules: readonly ModuleKey[];
}

export async function createAccountGroup(body: AccountGroupInput): Promise<void> {
  await http("/account/groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAccountGroup(id: string, body: AccountGroupInput): Promise<void> {
  await http(`/account/groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAccountGroup(id: string): Promise<void> {
  await http(`/account/groups/${id}`, { method: "DELETE" });
}

export async function listAccountGroupMembers(groupId: string): Promise<readonly AccountGroupMember[]> {
  const res = await http<ApiResponse<"getAccountGroupsByIdMembers">>(
    `/account/groups/${groupId}/members`,
  );
  return res.data;
}

export async function addAccountGroupMember(groupId: string, userId: string): Promise<void> {
  await http(`/account/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function removeAccountGroupMember(groupId: string, userId: string): Promise<void> {
  await http(`/account/groups/${groupId}/members/${userId}`, { method: "DELETE" });
}

// The built-in Default entry (FEAT-043): fallback modules for users in no
// group, backed by the `account.default_modules` setting rather than a row.
export async function getDefaultGroupModules(): Promise<DefaultGroupModules> {
  const res = await http<ApiResponse<"getAccountGroupsDefault">>("/account/groups/default");
  return res.data.modules;
}

export async function updateDefaultGroupModules(modules: readonly ModuleKey[]): Promise<DefaultGroupModules> {
  const res = await http<ApiResponse<"patchAccountGroupsDefault">>("/account/groups/default", {
    method: "PATCH",
    body: JSON.stringify({ modules }),
  });
  return res.data.modules;
}
