// System data layer: version/build info and lode release-management actions
// (backend apps/api/src/modules/system). Consumed by the admin About tab.

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export interface LodeHistoryEntry {
  readonly version: string;
  readonly at: string;
  readonly result: "good" | "bad";
}

export interface LodeConfig {
  readonly status?: string | null;
  readonly app?: string | null;
  readonly sourceType?: string | null;
  readonly source?: string | null;
  readonly asset?: string | null;
  readonly channel?: string | null;
  readonly policy?: string | null;
  readonly checkInterval?: number | null;
  readonly keepVersions?: number | null;
  readonly pin?: string | null;
  readonly requireSignature?: string | null;
  readonly runtime?: string | null;
  readonly runtimeVersion?: string | null;
}

export interface LodeStatus {
  readonly supervised?: boolean | null;
  readonly active?: boolean | null;
  readonly stateAvailable?: boolean | null;
  readonly status?: string | null;
  readonly current?: string | null;
  readonly lastGood?: string | null;
  readonly available?: string | null;
  readonly channel?: string | null;
  readonly activeVersion?: string | null;
  readonly readinessMode?: string | null;
  readonly ready?: boolean | null;
  readonly hold?: boolean | null;
  readonly configChanged?: boolean | null;
  readonly lastCheckAt?: string | null;
  readonly lastError?: string | null;
  readonly history?: readonly LodeHistoryEntry[] | null;
  readonly updateAvailable?: boolean | null;
  readonly rollbackTarget?: string | null;
  readonly config?: LodeConfig | null;
}

export interface SystemVersion {
  readonly version: string | null;
  readonly commit: string | null;
  readonly buildTime: string | null;
  readonly lode?: LodeStatus | null;
}

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
