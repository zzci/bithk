// Webhook subscriptions data layer (FEAT-060): typed hooks over the admin-only
// `/admin/webhooks/*` routes (backend apps/api/src/modules/notification). The
// signing secret is write-only — views carry `hasSecret`, never the value, and
// the PATCH sends `secret` only when the admin typed a new one (or `null` to
// clear it).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData, ApiRow } from "./_generated";
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Server view shapes are aliases of the generated OpenAPI types; regenerate
// with `bun run gen:api-types` after backend route changes.
export type WebhookView = ApiRow<"getAdminWebhooks">;
export type WebhookDelivery = ApiRow<"getAdminWebhooksByIdDeliveries">;
export type WebhookTestResult = ApiData<"postAdminWebhooksByIdTest">;

export interface WebhookInput {
  readonly name: string;
  readonly url: string;
  readonly secret?: string;
  readonly events: readonly string[];
  readonly enabled?: boolean;
}

export interface WebhookPatch {
  readonly name?: string;
  readonly url?: string;
  /** Omit to keep the saved secret; `null` clears it; a string replaces it. */
  readonly secret?: string | null;
  readonly events?: readonly string[];
  readonly enabled?: boolean;
}

export const webhookKeys = {
  all: ["webhooks"] as const,
  list: ["webhooks", "list"] as const,
  deliveries: (id: string) => ["webhooks", "deliveries", id] as const,
};

export function useWebhooks() {
  return useQuery<readonly WebhookView[]>({
    queryKey: webhookKeys.list,
    queryFn: async () => (await http<ApiEnvelope<readonly WebhookView[]>>("/admin/webhooks")).data,
    staleTime: 5_000,
  });
}

function useInvalidateList() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: webhookKeys.list });
  };
}

export function useCreateWebhook(): UseMutationResult<WebhookView, Error, WebhookInput> {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: input => http<ApiEnvelope<WebhookView>>("/admin/webhooks", { method: "POST", body: JSON.stringify(input) }).then(r => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateWebhook(): UseMutationResult<WebhookView, Error, { readonly id: string; readonly patch: WebhookPatch }> {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      http<ApiEnvelope<WebhookView>>(`/admin/webhooks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }).then(r => r.data),
    onSuccess: invalidate,
  });
}

export function useDeleteWebhook(): UseMutationResult<null, Error, string> {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/admin/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }).then(r => r.data),
    onSuccess: invalidate,
  });
}

export function useTestWebhook(): UseMutationResult<WebhookTestResult, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<WebhookTestResult>>(`/admin/webhooks/${encodeURIComponent(id)}/test`, { method: "POST" }).then(r => r.data),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: webhookKeys.deliveries(id) });
      void queryClient.invalidateQueries({ queryKey: webhookKeys.list });
    },
  });
}

/** Latest deliveries (newest first) for one webhook; idle while `id` is null. */
export function useWebhookDeliveries(id: string | null) {
  return useQuery<readonly WebhookDelivery[]>({
    queryKey: webhookKeys.deliveries(id ?? ""),
    queryFn: async () => (await http<ApiListEnvelope<WebhookDelivery>>(`/admin/webhooks/${encodeURIComponent(id ?? "")}/deliveries?limit=20`)).data,
    enabled: id !== null,
    refetchInterval: 3_000,
  });
}
