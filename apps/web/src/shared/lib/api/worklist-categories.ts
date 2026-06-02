// Worklist categories data layer: the global admin-managed vocabulary that
// seeds the worklist form's free-text `category` field as suggestions
// (apps/api/src/modules/ship worklist-categories routes, all admin-only).

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

export interface WorklistCategory {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorklistCategoryInput {
  readonly name?: string;
  readonly description?: string | null;
}

export const worklistCategoryKeys = {
  all: ["worklist-categories"] as const,
};

export function useWorklistCategories() {
  return useQuery<readonly WorklistCategory[]>({
    queryKey: worklistCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly WorklistCategory[]>>("/worklist-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateWorklistCategory(): UseMutationResult<WorklistCategory, Error, { name: string } & WorklistCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<WorklistCategory>>("/worklist-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: worklistCategoryKeys.all });
    },
  });
}

export function useUpdateWorklistCategory(): UseMutationResult<WorklistCategory, Error, { id: string } & WorklistCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<WorklistCategory>>(`/worklist-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: worklistCategoryKeys.all });
    },
  });
}

export function useDeleteWorklistCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/worklist-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: worklistCategoryKeys.all });
    },
  });
}
