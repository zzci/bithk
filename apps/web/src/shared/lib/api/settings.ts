// Generic platform settings data layer: typed hooks over the admin-only
// `/settings/:key` CRUD routes (apps/api/src/modules/settings). Values are
// opaque strings; callers interpret them per key. An unset setting is modelled
// as `null` (the backend answers GET with 404 when the key has no value).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData, ApiResponse, ApiRow } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http, HttpError } from "../http";

// Server view shapes are aliases of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.

type SettingPayload = ApiData<"getSettingsByKey">;

/** A settings row as returned by the prefix-list endpoint. */
export type SettingRow = ApiRow<"getSettings">;

export const settingKeys = {
  all: ["settings"] as const,
  detail: (key: string) => ["settings", key] as const,
  // Prefix/list keys nest under the shared root so saves/deletes that
  // invalidate the root also drop the list caches.
  prefix: (prefix: string) => ["settings", "prefix", prefix] as const,
};

// ── Plain request functions ──
//
// Used by the imperative admin settings tabs (SMTP toggles) that sequence
// several writes and refetch explicitly.

export async function putSetting(key: string, value: string): Promise<void> {
  await http(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await http(`/settings/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function listSettingsByPrefix(prefix: string): Promise<readonly SettingRow[]> {
  const res = await http<ApiResponse<"getSettings">>(
    `/settings?prefix=${encodeURIComponent(prefix)}`,
  );
  return res.data;
}

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
