// Admin Settings → Backup tab (PLAN-075 Phase 5 + R7 UI). Export card lives
// here; the import + standalone blob-restore card is colocated in
// `-settings-backup-import.tsx`, the report renderer and the API view types
// in `-settings-backup-report.tsx`.
import type { BackupModuleView, BlobsMode, ExportJobView } from "./-settings-backup-report";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";
import { BASE_PATH, http, HttpError } from "@/shared/lib/http";
import { BackupImportCard } from "./-settings-backup-import";

export function BackupSettingsTab() {
  return (
    <div className="space-y-4 pt-4">
      <BackupExportCard />
      <BackupImportCard />
    </div>
  );
}

// ─── Export card ──────────────────────────────────────────────────────────

const modulesQueryKey = ["backup", "modules"] as const;

const BLOB_MODES: readonly BlobsMode[] = ["embedded", "separate", "none"];

function BackupExportCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [blobsMode, setBlobsMode] = useState<BlobsMode>("embedded");
  const [jobId, setJobId] = useState<string | null>(null);

  const modulesQuery = useQuery({
    queryKey: modulesQueryKey,
    queryFn: async () => (await http<{ modules: BackupModuleView[] }>("/backup/modules")).modules,
  });
  const modules = modulesQuery.data ?? [];
  const selected = modules.map(m => m.name).filter(name => !excluded.has(name));

  const jobQuery = useQuery({
    queryKey: ["backup", "export-job", jobId],
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
  const job = jobQuery.data;
  // The in-memory job disappears once every artifact has been downloaded
  // (or after a server restart) — both surface as a poll 404.
  const jobGone = jobQuery.error instanceof HttpError && jobQuery.error.status === 404;
  const jobActive = job !== undefined && !jobGone
    && (job.state === "pending" || job.state === "running");

  const generate = useMutation({
    mutationFn: async () => http<{ jobId: string }>("/backup/v2/exports", {
      method: "POST",
      body: JSON.stringify({ modules: selected, blobs: blobsMode }),
    }),
    onSuccess: res => setJobId(res.jobId),
    onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
  });

  const cancel = useMutation({
    mutationFn: async () => http(`/backup/v2/exports/${jobId}`, { method: "DELETE" }),
    onSuccess: () => setJobId(null),
    onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
  });

  const toggleModule = (name: string, checked: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked)
        next.delete(name);
      else
        next.add(name);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings:backup.export.title")}</CardTitle>
        <CardDescription>{t("settings:backup.export.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {modulesQuery.error && (
          <ErrorBanner message={errorMessage(modulesQuery.error, t("common:common.error.loadFailed"))} />
        )}

        {modulesQuery.isLoading
          ? <EmptyHint>{t("common:common.loading")}</EmptyHint>
          : (
              <fieldset>
                <legend className="text-sm font-medium">{t("settings:backup.export.modules")}</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("settings:backup.export.modulesHint")}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {modules.map(module => (
                    <label key={module.name} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={!excluded.has(module.name)}
                        disabled={jobActive}
                        onChange={e => toggleModule(module.name, e.currentTarget.checked)}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{module.name}</span>
                        {module.deps.length > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {t("settings:backup.export.deps", { deps: module.deps.join(", ") })}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

        <div className="space-y-1.5">
          <Label id="backup-blob-mode-label">{t("settings:backup.export.blobMode")}</Label>
          <Select
            value={blobsMode}
            onValueChange={v => v !== null && setBlobsMode(v as BlobsMode)}
            disabled={jobActive}
          >
            <SelectTrigger
              className="w-full sm:w-80"
              aria-labelledby="backup-blob-mode-label"
              aria-describedby="backup-blob-mode-help"
            >
              <SelectValue>
                {(v: BlobsMode) => blobModeLabel(t, v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BLOB_MODES.map(mode => (
                <SelectItem key={mode} value={mode}>{blobModeLabel(t, mode)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="backup-blob-mode-help" className="text-xs text-muted-foreground">
            {t("settings:backup.export.blobModeHelp")}
          </p>
        </div>

        <Button
          type="button"
          disabled={selected.length === 0 || generate.isPending || jobActive}
          onClick={() => generate.mutate()}
        >
          {t("settings:backup.export.generate")}
        </Button>

        {jobGone && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            <span>{t("settings:backup.export.jobGone")}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setJobId(null)}>
              {t("settings:backup.export.dismiss")}
            </Button>
          </div>
        )}

        {job && !jobGone && (
          <ExportJobPanel
            job={job}
            cancelPending={cancel.isPending}
            onCancel={() => cancel.mutate()}
          />
        )}
      </CardContent>
    </Card>
  );
}

function blobModeLabel(t: (key: string) => string, mode: BlobsMode): string {
  if (mode === "separate")
    return t("settings:backup.export.blobModeSeparate");
  if (mode === "none")
    return t("settings:backup.export.blobModeNone");
  return t("settings:backup.export.blobModeEmbedded");
}

function ExportJobPanel({ job, cancelPending, onCancel }: {
  readonly job: ExportJobView;
  readonly cancelPending: boolean;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);

  if (job.state === "failed") {
    return (
      <div className="space-y-2">
        <ErrorBanner message={`${t("settings:backup.export.stateFailed")}: ${job.error ?? ""}`} />
        <Button type="button" variant="outline" size="sm" disabled={cancelPending} onClick={onCancel}>
          {t("settings:backup.export.discard")}
        </Button>
      </div>
    );
  }

  if (job.state === "pending" || job.state === "running") {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Spinner className="size-4" />
          {t("settings:backup.export.stateRunning")}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings:backup.export.progressTables", {
            done: job.progress.tablesDone,
            total: job.progress.tablesTotal,
          })}
        </p>
        {job.blobsMode !== "none" && (
          <p className="text-sm text-muted-foreground">
            {t("settings:backup.export.progressBlobBytes", {
              done: formatBytes(job.progress.blobBytesDone),
              total: formatBytes(job.progress.blobBytesTotal),
            })}
          </p>
        )}
        <Button type="button" variant="outline" size="sm" disabled={cancelPending} onClick={onCancel}>
          {t("settings:backup.export.cancel")}
        </Button>
      </div>
    );
  }

  // completed | downloaded
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-sm font-medium">{t("settings:backup.export.stateCompleted")}</div>
      {job.artifacts && (
        <div className="flex flex-wrap items-center gap-2">
          <ArtifactDownload
            jobId={job.jobId}
            artifact="data"
            label={job.artifacts.blobs
              ? t("settings:backup.export.downloadData")
              : t("settings:backup.export.download")}
            size={job.artifacts.data.size}
            downloaded={job.artifacts.data.downloaded}
          />
          {job.artifacts.blobs && (
            <ArtifactDownload
              jobId={job.jobId}
              artifact="blobs"
              label={t("settings:backup.export.downloadBlobs")}
              size={job.artifacts.blobs.size}
              downloaded={job.artifacts.blobs.downloaded}
            />
          )}
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" disabled={cancelPending} onClick={onCancel}>
        {t("settings:backup.export.discard")}
      </Button>
    </div>
  );
}

function ArtifactDownload({ jobId, artifact, label, size, downloaded }: {
  readonly jobId: string;
  readonly artifact: "data" | "blobs";
  readonly label: string;
  readonly size: number;
  readonly downloaded: boolean;
}) {
  const { t } = useTranslation("settings");
  return (
    <span className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        render={<a href={`${BASE_PATH}/api/backup/v2/exports/${jobId}/download?artifact=${artifact}`} />}
      >
        {`${label} (${formatBytes(size)})`}
      </Button>
      {downloaded && <Badge variant="secondary">{t("backup.export.artifactDownloaded")}</Badge>}
    </span>
  );
}
