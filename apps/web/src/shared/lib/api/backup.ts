// Backup v2 data layer (PLAN-075 R5/R7 + FIX-053): module catalog, export
// jobs, staged imports, and the standalone blob-restore. View types mirror
// the apps/api/src/modules/backup contracts; the report RENDERER stays with
// the admin settings tab (`-settings-backup-report.tsx`).

import type { UseMutationResult } from "@tanstack/react-query";
import type { ApiResponse, operations } from "./_generated";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──
//
// Server view shapes derive from the generated OpenAPI types (REFACTOR-037);
// regenerate with `bun run gen:api-types` after backend route changes.

// Blob handling mode, from the POST /backup/v2/exports request body.
export type BlobsMode = NonNullable<
  operations["postBackupV2Exports"]["requestBody"]["content"]["application/json"]["blobs"]
>;

export type BackupModuleView = ApiResponse<"getBackupModules">["modules"][number];

export type ExportJobView = ApiResponse<"getBackupV2ExportsByJobId">;

export type ExportArtifactView = NonNullable<ExportJobView["artifacts"]>["data"];

export type ImportJobView = ApiResponse<"getBackupV2ImportsByImportId">;

/** The staged dry-run report — blobs are existence checks, never written. */
export type ImportDryRunReport = ImportJobView["report"];

/** The final apply report (`result` on the poll route once completed). */
export type ImportApplyReport = NonNullable<ImportJobView["result"]>;

/** Either report flavour; the renderer narrows by field (`"written" in blobs`). */
export type ImportReport = ImportDryRunReport | ImportApplyReport;

export type ImportTableReport = ImportDryRunReport["tables"][string];

export type ImportFailedRow = ImportTableReport["failed"]["sample"][number];

/** Dry-run blob existence checks — blobs are never written before apply. */
export type DryRunBlobCounts = ImportDryRunReport["blobs"];

/** Apply-stage blob counters (R7: `expectedInSeparateArchive` vs `missing`). */
export type ApplyBlobCounts = ImportApplyReport["blobs"];

export type BlobRestoreReport = ApiResponse<"postBackupV2BlobRestores">["report"];

// ── Query keys ──

export const backupKeys = {
  modules: ["backup", "modules"] as const,
  exportJob: (jobId: string | null) => ["backup", "export-job", jobId] as const,
  importJob: (importId: string | null) => ["backup", "import-job", importId] as const,
};

// ── Modules ──

export function useBackupModules() {
  return useQuery({
    queryKey: backupKeys.modules,
    queryFn: async () => (await http<ApiResponse<"getBackupModules">>("/backup/modules")).modules,
  });
}

// ── Export ──

export function useBackupExportJob(jobId: string | null) {
  return useQuery({
    queryKey: backupKeys.exportJob(jobId),
    queryFn: async () => http<ExportJobView>(`/backup/v2/exports/${jobId}`),
    enabled: jobId !== null,
    // Poll while generating; keep a slow poll on `completed` so per-artifact
    // downloaded flags refresh after the operator clicks a download link.
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "pending" || state === "running")
        return 800;
      return state === "completed" ? 3000 : false;
    },
  });
}

export interface StartBackupExportInput {
  readonly modules: readonly string[];
  readonly blobs: BlobsMode;
}

// Export start is a 202 Accepted with the job handle.
type StartBackupExportResult = ApiResponse<"postBackupV2Exports", 202>;

export function useStartBackupExport(): UseMutationResult<StartBackupExportResult, Error, StartBackupExportInput> {
  return useMutation({
    mutationFn: async body => http<StartBackupExportResult>("/backup/v2/exports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  });
}

export function useCancelBackupExport(): UseMutationResult<unknown, Error, string> {
  return useMutation({
    mutationFn: async jobId => http(`/backup/v2/exports/${jobId}`, { method: "DELETE" }),
  });
}

// ── Import ──

export function useBackupImportJob(importId: string | null) {
  return useQuery({
    queryKey: backupKeys.importJob(importId),
    queryFn: async () => http<ImportJobView>(`/backup/v2/imports/${importId}`),
    enabled: importId !== null,
    refetchInterval: query => query.state.data?.state === "applying" ? 800 : false,
  });
}

// Upload is a 201 Created with the staged import id + dry-run report.
type UploadBackupImportResult = ApiResponse<"postBackupV2Imports", 201>;

export function useUploadBackupImport(): UseMutationResult<UploadBackupImportResult, Error, File> {
  return useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      return http<UploadBackupImportResult>("/backup/v2/imports", {
        method: "POST",
        body: formData,
      });
    },
  });
}

export interface ApplyBackupImportInput {
  readonly importId: string;
  readonly mode: "merge" | "replace";
  readonly includeUsers?: boolean;
}

export function useApplyBackupImport(): UseMutationResult<unknown, Error, ApplyBackupImportInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ importId, ...body }) =>
      http(`/backup/v2/imports/${importId}/apply`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { importId }) => {
      void queryClient.invalidateQueries({ queryKey: backupKeys.importJob(importId) });
    },
  });
}

export function useDiscardBackupImport(): UseMutationResult<unknown, Error, string> {
  return useMutation({
    // The job may already be gone server-side (TTL sweep, restart) — a 404
    // still means "nothing staged anymore", so resolve instead of throwing.
    mutationFn: async importId => http(`/backup/v2/imports/${importId}`, { method: "DELETE" }).catch(() => undefined),
  });
}

// ── Standalone blob restore (R7) ──

export function useRestoreBlobArchive(): UseMutationResult<{ report: BlobRestoreReport }, Error, File> {
  return useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      return http<{ report: BlobRestoreReport }>("/backup/v2/blob-restores", {
        method: "POST",
        body: formData,
      });
    },
  });
}
