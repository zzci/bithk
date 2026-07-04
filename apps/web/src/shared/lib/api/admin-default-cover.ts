// Admin-only data layer for the global project default cover. Wraps the three
// /admin/project-default-cover endpoints (T13a): GET reads the current default
// (referenceId + preview url, both null when unset), POST uploads/replaces it
// via multipart, DELETE releases the reference and clears the setting. The
// visual picker in the admin Project Defaults tab consumes these hooks. Kept
// separate from projects.ts, which owns the unrelated per-project covers.

import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import type { ApiData } from "./_generated";
import type { ApiEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Server view shape is an alias of the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.
export type DefaultCover = ApiData<"getAdminProjectDefaultCover">;

const defaultCoverKeys = {
  all: ["admin", "project-default-cover"] as const,
};

const PATH = "/admin/project-default-cover";

/**
 * Read the current global default project cover. `referenceId`/`url` are both
 *  `null` when unset (or when the stored reference dangles).
 */
export function useDefaultCover(): UseQueryResult<DefaultCover> {
  return useQuery<DefaultCover>({
    queryKey: defaultCoverKeys.all,
    queryFn: () => http<ApiEnvelope<DefaultCover>>(PATH).then(r => r.data),
    staleTime: 5_000,
  });
}

/**
 * Upload (or replace) the default cover via multipart `file`. The server
 *  releases any prior reference.
 */
export function useUploadDefaultCover(): UseMutationResult<DefaultCover, Error, File> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append("file", file);
      return http<ApiEnvelope<DefaultCover>>(PATH, { method: "POST", body: fd }).then(r => r.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: defaultCoverKeys.all });
    },
  });
}

/** Release the reference and clear the default cover setting (idempotent). */
export function useRemoveDefaultCover(): UseMutationResult<null, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => http<ApiEnvelope<null>>(PATH, { method: "DELETE" }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: defaultCoverKeys.all });
    },
  });
}
