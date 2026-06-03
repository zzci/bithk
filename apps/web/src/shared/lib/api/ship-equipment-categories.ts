// Per-ship equipment-category data layer: each ship owns its own bilingual
// category set (apps/api `/ships/:shortId/equipment-categories` routes — read =
// base-project member, write = project.manage). Seeded from the global template
// on ship creation. Mirrors the per-project procurement-categories hooks; the
// query key is scoped by ship shortId so one ship's categories never bleed into
// another's cache.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export interface ShipEquipmentCategory {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShipEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

const shipEquipmentCategoryKeys = {
  list: (shipShortId: string) => ["ships", shipShortId, "equipment-categories"] as const,
};

function basePath(shipShortId: string): string {
  return `/ships/${encodeURIComponent(shipShortId)}/equipment-categories`;
}

export function useShipEquipmentCategories(shipShortId: string | undefined) {
  return useQuery<readonly ShipEquipmentCategory[]>({
    queryKey: shipEquipmentCategoryKeys.list(shipShortId ?? ""),
    queryFn: () => http<ApiEnvelope<readonly ShipEquipmentCategory[]>>(basePath(shipShortId!)).then(r => r.data),
    enabled: !!shipShortId,
    staleTime: 5_000,
  });
}

export function useCreateShipEquipmentCategory(shipShortId: string): UseMutationResult<ShipEquipmentCategory, Error, ShipEquipmentCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<ShipEquipmentCategory>>(basePath(shipShortId), {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.list(shipShortId) });
    },
  });
}

export function useUpdateShipEquipmentCategory(shipShortId: string): UseMutationResult<ShipEquipmentCategory, Error, { id: string } & Partial<ShipEquipmentCategoryInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<ShipEquipmentCategory>>(`${basePath(shipShortId)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.list(shipShortId) });
    },
  });
}

export function useDeleteShipEquipmentCategory(shipShortId: string): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`${basePath(shipShortId)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shipEquipmentCategoryKeys.list(shipShortId) });
    },
  });
}
