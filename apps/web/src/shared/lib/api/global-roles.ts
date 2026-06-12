// Global roles data layer (PLAN-076, FEAT-031): admin-managed app-level roles
// that grant per-module visibility. Backed by the admin-only `/global-roles`
// CRUD routes. The system default role (kind === "default") is the locked
// zero-module Guest; users with a NULL `globalRoleId` resolve to it
// server-side. The list endpoint carries a per-role `userCount` (non-admin
// users; NULL assignments bucket to Guest).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Mirrors the API's static module registry (apps/api/src/shared/modules.ts).
// Drives the module checkbox table on the admin Roles page.
export const MODULE_KEYS = ["documents", "drive", "projects", "ships", "contacts", "hr"] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

export interface GlobalRoleView {
  readonly id: string;
  readonly name: string;
  readonly modules: readonly ModuleKey[];
  readonly isSystem: boolean;
  readonly kind: "default" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  // Present on the list endpoint only (mutation responses omit it).
  readonly userCount?: number;
}

export interface GlobalRoleInput {
  readonly name: string;
  readonly modules: readonly ModuleKey[];
}

const globalRoleKeys = {
  all: ["global-roles"] as const,
};

export function useGlobalRoles() {
  return useQuery<readonly GlobalRoleView[]>({
    queryKey: globalRoleKeys.all,
    queryFn: () => http<ApiEnvelope<readonly GlobalRoleView[]>>("/global-roles").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateGlobalRole(): UseMutationResult<GlobalRoleView, Error, GlobalRoleInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<GlobalRoleView>>("/global-roles", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalRoleKeys.all });
    },
  });
}

export function useUpdateGlobalRole(): UseMutationResult<GlobalRoleView, Error, { id: string } & Partial<GlobalRoleInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<GlobalRoleView>>(`/global-roles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalRoleKeys.all });
    },
  });
}

export function useDeleteGlobalRole(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/global-roles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalRoleKeys.all });
    },
  });
}
