// Equipment categories data layer: the global admin-managed bilingual
// vocabulary used to classify ship equipment (apps/api equipment-categories
// routes — all admin-only). Mirrors contact-categories.ts.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export interface EquipmentCategory {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

const equipmentCategoryKeys = {
  all: ["equipment-categories"] as const,
};

/**
 * Pick the locale-appropriate equipment category name, falling back to the
 * other language when one side is empty. `isZh` is derived from the active i18n
 * language by the caller (`i18n.language?.startsWith("zh")`).
 */
export function resolveCategoryName(
  names: { readonly nameZh: string | null; readonly nameEn: string | null },
  isZh: boolean,
): string {
  const zh = names.nameZh ?? "";
  const en = names.nameEn ?? "";
  return isZh ? (zh || en) : (en || zh);
}

export function useEquipmentCategories() {
  return useQuery<readonly EquipmentCategory[]>({
    queryKey: equipmentCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly EquipmentCategory[]>>("/equipment-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateEquipmentCategory(): UseMutationResult<EquipmentCategory, Error, EquipmentCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<EquipmentCategory>>("/equipment-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: equipmentCategoryKeys.all });
    },
  });
}

export function useUpdateEquipmentCategory(): UseMutationResult<EquipmentCategory, Error, { id: string } & Partial<EquipmentCategoryInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<EquipmentCategory>>(`/equipment-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: equipmentCategoryKeys.all });
    },
  });
}

export function useDeleteEquipmentCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/equipment-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: equipmentCategoryKeys.all });
    },
  });
}
