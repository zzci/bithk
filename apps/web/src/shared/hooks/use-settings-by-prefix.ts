import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { listSettingsByPrefix, settingKeys } from "@/shared/lib/api/settings";

export type { SettingRow } from "@/shared/lib/api/settings";

// Prefix/list query key, nested under the shared `["settings"]` namespace from
// the settings api layer so saves/deletes that invalidate the root also drop
// these list caches — the two layers can no longer diverge for the same key.
export const settingsPrefixKey = settingKeys.prefix;

export function useSettingsByPrefix(prefix: string) {
  // Consumer-supplied error overlay (e.g. a failed toggle/delete) sits on top
  // of the query's own load error; cleared on refetch, matching the prior hook.
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: settingKeys.prefix(prefix),
    queryFn: () => listSettingsByPrefix(prefix),
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
