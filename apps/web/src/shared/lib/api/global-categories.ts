// Global procurement categories data layer: the admin-managed template set
// copied into each new project on create (apps/api/src/modules/project
// global-procurement-categories routes, all admin-only).

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

export interface GlobalProcurementCategory {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GlobalCategoryInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

export const globalCategoryKeys = {
  all: ["global-procurement-categories"] as const,
};

export function useGlobalCategories() {
  return useQuery<readonly GlobalProcurementCategory[]>({
    queryKey: globalCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly GlobalProcurementCategory[]>>("/global-procurement-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateGlobalCategory(): UseMutationResult<GlobalProcurementCategory, Error, { name: string } & GlobalCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<GlobalProcurementCategory>>("/global-procurement-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalCategoryKeys.all });
    },
  });
}

export function useUpdateGlobalCategory(): UseMutationResult<GlobalProcurementCategory, Error, { id: string } & GlobalCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<GlobalProcurementCategory>>(`/global-procurement-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalCategoryKeys.all });
    },
  });
}

export function useDeleteGlobalCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/global-procurement-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: globalCategoryKeys.all });
    },
  });
}
