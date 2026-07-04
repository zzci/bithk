// Admin Storage data layer (FEAT-047): typed hooks over the admin-only
// `/admin/storage/*` routes. Storage config lives in the DB (settings); the S3
// secret is write-only (never returned — the config exposes `secretConfigured`
// instead) and is only sent when the admin types a new value.

import type { ApiData, ApiResponse, ApiRow } from "./_generated";
import type { ApiEnvelope, ApiListEnvelope } from "./types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// Server view shapes are aliases of the generated OpenAPI types (FEAT-049);
// regenerate with `bun run gen:api-types` after backend route changes.
// Frontend-only types (mutation inputs) stay hand-written below.

export type StorageConfigView = ApiData<"getAdminStorageConfig">;
export type UploadDriver = StorageConfigView["uploadDriver"];
export type StorageS3ConfigView = StorageConfigView["s3"];

export interface SaveStorageConfigInput {
  readonly uploadDriver: UploadDriver;
  readonly s3: {
    readonly bucket?: string;
    readonly region?: string;
    readonly endpoint?: string;
    readonly accessKeyId?: string;
    /** Only send when the admin typed a new secret; omitted = keep existing. */
    readonly secret?: string;
    readonly prefix?: string;
  };
}

export type StorageFileView = ApiRow<"getAdminStorageFiles">;

export type SyncToS3Summary = ApiData<"postAdminStorageSyncToS3">;

export const storageKeys = {
  config: ["storage", "config"] as const,
  files: (page: number) => ["storage", "files", page] as const,
};

export function useStorageConfig() {
  return useQuery<StorageConfigView>({
    queryKey: storageKeys.config,
    queryFn: async () => {
      const res = await http<ApiEnvelope<StorageConfigView>>("/admin/storage/config");
      return res.data;
    },
    staleTime: 5_000,
  });
}

export function useSaveStorageConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveStorageConfigInput) =>
      http<ApiEnvelope<null>>("/admin/storage/config", {
        method: "PUT",
        body: JSON.stringify(input),
      }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: storageKeys.config });
      void queryClient.invalidateQueries({ queryKey: ["storage", "files"] });
    },
  });
}

export interface StorageFilesPage {
  readonly data: readonly StorageFileView[];
  readonly meta: ApiResponse<"getAdminStorageFiles">["meta"];
}

export function useStorageFiles(page: number) {
  return useQuery<StorageFilesPage>({
    queryKey: storageKeys.files(page),
    queryFn: async () => {
      const res = await http<ApiListEnvelope<StorageFileView>>(`/admin/storage/files?page=${page}&limit=20`);
      return { data: res.data, meta: res.meta };
    },
    staleTime: 5_000,
  });
}

export function useSyncToS3() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      http<ApiEnvelope<SyncToS3Summary>>("/admin/storage/sync-to-s3", {
        method: "POST",
      }).then(r => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["storage", "files"] });
    },
  });
}
