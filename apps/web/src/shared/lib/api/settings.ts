// Generic platform settings data layer: typed hooks over the admin-only
// `/settings/:key` CRUD routes (apps/api/src/modules/settings). Values are
// opaque strings; callers interpret them per key. An unset setting is modelled
// as `null` (the backend answers GET with 404 when the key has no value).

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, HttpError } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

interface SettingPayload {
  readonly key: string;
  readonly value: string;
}

const settingKeys = {
  all: ["settings"] as const,
  detail: (key: string) => ["settings", key] as const,
};

/**
 * Read a single setting. Resolves to the stored string, or `null` when the key
 * is unset (the route answers 404 in that case — we treat it as "no value"
 * rather than an error so the UI can show an empty/default state).
 */
export function useSetting(key: string) {
  return useQuery<string | null>({
    queryKey: settingKeys.detail(key),
    queryFn: async () => {
      try {
        const res = await http<ApiEnvelope<SettingPayload>>(`/settings/${encodeURIComponent(key)}`);
        return res.data.value;
      }
      catch (err) {
        if (err instanceof HttpError && err.status === 404)
          return null;
        throw err;
      }
    },
    staleTime: 5_000,
  });
}

export function usePutSetting(): UseMutationResult<null, Error, { key: string; value: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => http<ApiEnvelope<null>>(`/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }).then(r => r.data),
    onSuccess: (_data, { key }) => {
      void queryClient.invalidateQueries({ queryKey: settingKeys.detail(key) });
    },
  });
}

export function useDeleteSetting(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: key => http<ApiEnvelope<null>>(`/settings/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: (_data, key) => {
      void queryClient.invalidateQueries({ queryKey: settingKeys.detail(key) });
    },
  });
}
