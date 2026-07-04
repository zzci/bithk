// System data layer: version/build info and lode release-management actions
// (backend apps/api/src/modules/system). Consumed by the admin About tab.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData } from "./_generated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes. `lode`
// mirrors the backend `LodeSummary` (FIX-059): optional fields are OMITTED
// (not null) when lode has nothing to report for them.

export type SystemVersion = ApiData<"getSystemVersion">;

export type LodeStatus = SystemVersion["lode"];
export type LodeConfig = LodeStatus["config"];
export type LodeHistoryEntry = LodeStatus["history"][number];

// ── Query keys ──

export const systemKeys = {
  version: ["system", "version"] as const,
};

// ── Queries ──

export function useSystemVersion() {
  return useQuery({
    queryKey: systemKeys.version,
    queryFn: async () => (await http<{ data: SystemVersion }>("/system/version")).data,
  });
}

// ── Lode mutations ──
//
// Each action refreshes the version/lode snapshot on success; callers layer
// their own UI feedback via per-mutate callbacks.

function useLodeMutation<TVars>(request: (vars: TVars) => Promise<unknown>): UseMutationResult<unknown, Error, TVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemKeys.version });
    },
  });
}

export function useLodeRestart(): UseMutationResult<unknown, Error, void> {
  return useLodeMutation(() => http("/system/lode/restart", { method: "POST" }));
}

export function useLodeUpdate(): UseMutationResult<unknown, Error, string> {
  return useLodeMutation(target => http("/system/lode/update", { method: "POST", body: JSON.stringify({ target }) }));
}

export function useLodeRollback(): UseMutationResult<unknown, Error, string | undefined> {
  return useLodeMutation(target => http("/system/lode/rollback", { method: "POST", body: JSON.stringify(target ? { version: target } : {}) }));
}

export function useLodeHold(): UseMutationResult<unknown, Error, boolean> {
  return useLodeMutation(hold => http("/system/lode/hold", { method: "POST", body: JSON.stringify({ hold }) }));
}
