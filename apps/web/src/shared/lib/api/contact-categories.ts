// Contact categories data layer: the global admin-managed vocabulary used to
// classify contacts (apps/api/src/modules contact-categories routes, all
// admin-only).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

export interface ContactCategory {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContactCategoryInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly description?: string | null;
}

export const contactCategoryKeys = {
  all: ["contact-categories"] as const,
};

export function useContactCategories() {
  return useQuery<readonly ContactCategory[]>({
    queryKey: contactCategoryKeys.all,
    queryFn: () => http<ApiEnvelope<readonly ContactCategory[]>>("/contact-categories").then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateContactCategory(): UseMutationResult<ContactCategory, Error, { name: string } & ContactCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: body => http<ApiEnvelope<ContactCategory>>("/contact-categories", {
      method: "POST",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactCategoryKeys.all });
    },
  });
}

export function useUpdateContactCategory(): UseMutationResult<ContactCategory, Error, { id: string } & ContactCategoryInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) => http<ApiEnvelope<ContactCategory>>(`/contact-categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactCategoryKeys.all });
    },
  });
}

export function useDeleteContactCategory(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/contact-categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactCategoryKeys.all });
    },
  });
}
