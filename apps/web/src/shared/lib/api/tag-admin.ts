// Tag administration data layer: create / rename / delete the global tag
// vocabulary (apps/api/src/modules/project tag-admin routes, all admin-only).
// Reads reuse `useTags` / `tagKeys` from `projects.ts`; this file only adds the
// admin mutations so it can own them without touching the projects module.

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiData, ApiResponse } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";
import { tagKeys } from "./projects";

// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.
// Unlike the `getTags` rows (`ProjectTag`), the write endpoints return the
// bare tag without `usageCount`.
type CreatedTag = ApiResponse<"postTags", 201>["data"];
type RenamedTag = ApiData<"patchTagsById">;

export function useCreateTag(): UseMutationResult<CreatedTag, Error, { name: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name }) => http<ApiEnvelope<CreatedTag>>("/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function useRenameTag(): UseMutationResult<RenamedTag, Error, { id: string; name: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }) => http<ApiEnvelope<RenamedTag>>(`/tags/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}

export function useDeleteTag(): UseMutationResult<null, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => http<ApiEnvelope<null>>(`/tags/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagKeys.all });
    },
  });
}
