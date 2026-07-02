// Backup v2 data layer (PLAN-075 R5/R7 + FIX-053): module catalog, export
// jobs, staged imports, and the standalone blob-restore. View types mirror
// the apps/api/src/modules/backup contracts; the report RENDERER stays with
// the admin settings tab (`-settings-backup-report.tsx`).

import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "../http";

// ── Types ──

export type BlobsMode = "embedded" | "separate" | "none";

export interface BackupModuleView {
  readonly name: string;
  readonly deps: readonly string[];
}

export interface ExportArtifactView {
  readonly size: number;
  readonly downloaded: boolean;
}

export interface ExportJobView {
  readonly jobId: string;
  readonly state: "pending" | "running" | "completed" | "downloaded" | "failed";
  readonly blobsMode: BlobsMode;
  readonly progress: {
    readonly tablesDone: number;
    readonly tablesTotal: number;
    readonly blobBytesDone: number;
    readonly blobBytesTotal: number;
  };
  readonly error: string | null;
  readonly archiveSize: number | null;
  /** Manifest warnings (blobs skipped per storage driver, …) — null until completed. */
  readonly warnings: readonly string[] | null;
  readonly artifacts: {
    readonly data: ExportArtifactView;
    readonly blobs?: ExportArtifactView;
  } | null;
}

export interface ImportFailedRow {
  readonly rowId: string;
  readonly reason: string;
}

export interface ImportTableReport {
  readonly inserted: number;
  readonly skippedDuplicate: number;
  readonly transformed: number;
  readonly droppedColumns: Record<string, number>;
  readonly defaultedColumns: Record<string, number>;
  readonly failed: { readonly total: number; readonly sample: readonly ImportFailedRow[] };
  readonly error?: string;
  readonly noKeyAppend?: boolean;
}

/** Dry-run blob existence checks — blobs are never written before apply. */
export interface DryRunBlobCounts {
  readonly count: number;
  readonly existing: number;
  readonly missing: number;
}

/** Apply-stage blob counters (R7: `expectedInSeparateArchive` vs `missing`). */
export interface ApplyBlobCounts {
  readonly written: number;
  readonly skippedExisting: number;
  readonly failed: number;
  readonly unreferenced: number;
  readonly missing: number;
  readonly expectedInSeparateArchive: number;
}

export interface ImportReport {
  readonly dryRun: boolean;
  readonly mode?: "merge" | "replace";
  readonly tables: Record<string, ImportTableReport>;
  readonly skippedTables: readonly string[];
  readonly skippedModules: readonly string[];
  readonly warnings: readonly string[];
  readonly totals: {
    readonly inserted: number;
    readonly skippedDuplicate: number;
    readonly failed: number;
    readonly transformed: number;
  };
  readonly replace?: {
    readonly tablesImported: number;
    readonly rowsImported: number;
    readonly includeUsers: boolean;
  };
  readonly blobs: DryRunBlobCounts | ApplyBlobCounts;
  readonly reconcile?: { readonly checked: number; readonly quarantined: number };
}

export interface ImportJobView {
  readonly importId: string;
  readonly state: "validated" | "applying" | "completed" | "failed";
  readonly report: ImportReport;
  readonly result: ImportReport | null;
  readonly error: string | null;
}

export interface BlobRestoreReport {
  readonly written: number;
  readonly skippedExisting: number;
  readonly failed: number;
  readonly unquarantined: number;
  readonly reconcile: { readonly checked: number; readonly quarantined: number };
}

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
    queryFn: async () => (await http<{ modules: BackupModuleView[] }>("/backup/modules")).modules,
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

export function useStartBackupExport(): UseMutationResult<{ jobId: string }, Error, StartBackupExportInput> {
  return useMutation({
    mutationFn: async body => http<{ jobId: string }>("/backup/v2/exports", {
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

export function useUploadBackupImport(): UseMutationResult<{ importId: string; report: ImportReport }, Error, File> {
  return useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      return http<{ importId: string; report: ImportReport }>("/backup/v2/imports", {
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
