// Ship equipment categories data layer: the global admin-managed bilingual
// vocabulary used to classify ship equipment (apps/api ship-equipment-categories
// routes — writes admin-only, reads open to any authenticated user). Mirrors
// contact-categories.ts.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export interface ShipEquipmentCategory {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShipEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
}

const shipEquipmentCategoryKeys = {
  all: ["ship-equipment-categories"] as const,
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

export function useShipEquipmentCategories() {
  return useQuery<readonly ShipEquipmentCategory[]>({
    queryKey: shipEquipmentCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly ShipEquipmentCategory[]>>("/ship-equipment-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateShipEquipmentCategory(): UseMutationResult<ShipEquipmentCategory, Error, ShipEquipmentCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<ShipEquipmentCategory>>("/ship-equipment-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.all });
    },
  });
}

export function useUpdateShipEquipmentCategory(): UseMutationResult<ShipEquipmentCategory, Error, { id: string } & Partial<ShipEquipmentCategoryInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<ShipEquipmentCategory>>(`/ship-equipment-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.all });
    },
  });
}

export function useDeleteShipEquipmentCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/ship-equipment-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.all });
    },
  });
}
