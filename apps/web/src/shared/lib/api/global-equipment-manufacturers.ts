// Global equipment-manufacturer vocabulary data layer: the admin-managed brand
// list (apps/api `/global-equipment-manufacturers` routes — all admin-only)
// that ship equipment references directly via `manufacturerId`. Unlike
// categories there is NO per-ship copy and NO bilingual split — a manufacturer
// has a single canonical `name`. Mirrors global-equipment-categories.ts.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export interface GlobalEquipmentManufacturer {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GlobalEquipmentManufacturerInput {
  readonly name: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

const globalEquipmentManufacturerKeys = {
  all: ["global-equipment-manufacturers"] as const,
};

export function useGlobalEquipmentManufacturers() {
  return useQuery<readonly GlobalEquipmentManufacturer[]>({
    queryKey: globalEquipmentManufacturerKeys.all,
    queryFn: () => http<ApiEnvelope<readonly GlobalEquipmentManufacturer[]>>("/global-equipment-manufacturers").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateGlobalEquipmentManufacturer(): UseMutationResult<GlobalEquipmentManufacturer, Error, GlobalEquipmentManufacturerInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<GlobalEquipmentManufacturer>>("/global-equipment-manufacturers", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentManufacturerKeys.all });
    },
  });
}

export function useUpdateGlobalEquipmentManufacturer(): UseMutationResult<GlobalEquipmentManufacturer, Error, { id: string } & Partial<GlobalEquipmentManufacturerInput>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<GlobalEquipmentManufacturer>>(`/global-equipment-manufacturers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentManufacturerKeys.all });
    },
  });
}

export function useDeleteGlobalEquipmentManufacturer(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/global-equipment-manufacturers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalEquipmentManufacturerKeys.all });
    },
  });
}
