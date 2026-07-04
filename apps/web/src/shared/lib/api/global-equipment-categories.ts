// Global equipment-category TEMPLATE data layer: the admin-managed bilingual
// vocabulary (apps/api `/global-equipment-categories` routes — all admin-only)
// that each ship copies into its own category set on creation. Mirrors
// contact-categories.ts. Per-ship categories live in ship-equipment-categories.ts.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiRow } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Server view shape is an alias of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.
export type GlobalEquipmentCategory = ApiRow<"getGlobalEquipmentCategories">;

export interface GlobalEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

const globalEquipmentCategoryKeys = {
  all: ["global-equipment-categories"] as const,
};

/**
 * Pick the locale-appropriate equipment category name, falling back to the
 * other language when one side is empty. `isZh` is derived from the active i18n
 * language by the caller (`i18n.language?.startsWith("zh")`). Shared by the
 * global template surface, the per-ship category surface, and equipment views.
 */
export function resolveCategoryName(
  names: { readonly nameZh: string | null; readonly nameEn: string | null },
  isZh: boolean,
): string {
  const zh = names.nameZh ?? "";
  const en = names.nameEn ?? "";
  return isZh ? (zh || en) : (en || zh);
}

export function useGlobalEquipmentCategories() {
  return useQuery<readonly GlobalEquipmentCategory[]>({
    queryKey: globalEquipmentCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly GlobalEquipmentCategory[]>>("/global-equipment-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateGlobalEquipmentCategory(): UseMutationResult<GlobalEquipmentCategory, Error, GlobalEquipmentCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<GlobalEquipmentCategory>>("/global-equipment-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentCategoryKeys.all });
    },
  });
}

export function useUpdateGlobalEquipmentCategory(): UseMutationResult<GlobalEquipmentCategory, Error, { id: string } & Partial<GlobalEquipmentCategoryInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<GlobalEquipmentCategory>>(`/global-equipment-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentCategoryKeys.all });
    },
  });
}

export function useDeleteGlobalEquipmentCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/global-equipment-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentCategoryKeys.all });
    },
  });
}
