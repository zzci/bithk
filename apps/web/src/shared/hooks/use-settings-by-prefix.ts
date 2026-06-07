import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { settingKeys } from "@/shared/lib/api/settings";
import { http } from "@/shared/lib/http";

export interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

// Prefix/list query key, nested under the shared `["settings"]` namespace from
// the settings api layer so saves/deletes that invalidate the root also drop
// these list caches — the two layers can no longer diverge for the same key.
export const settingsPrefixKey = (prefix: string) => [...settingKeys.all, "prefix", prefix] as const;

export function useSettingsByPrefix(prefix: string) {
  // Consumer-supplied error overlay (e.g. a failed toggle/delete) sits on top
  // of the query's own load error; cleared on refetch, matching the prior hook.
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: settingsPrefixKey(prefix),
    queryFn: async () => {
      const res = await http<{ success: boolean; data: SettingRow[] }>(`/settings?prefix=${encodeURIComponent(prefix)}`);
      return res.data;
    },
  });

  const queryRefetch = query.refetch;
  const refetch = useCallback(async () => {
    setOverrideError(null);
    await queryRefetch();
  }, [queryRefetch]);

  const error = overrideError
    ?? (query.error instanceof Error
      ? query.error.message
      : query.isError
        ? "Failed to load settings"
        : null);

  return {
    settings: query.data ?? [],
    loading: query.isPending,
    error,
    setError: setOverrideError,
    refetch,
  };
}
