// Admin Settings → Backup tab (PLAN-075 Phase 5 + R7 UI). Export card lives
// here; the import + standalone blob-restore card is colocated in
// `-settings-backup-import.tsx`, the report renderer and the API view types
// in `-settings-backup-report.tsx`.
import type { ExportJobView } from "@/shared/lib/api/backup";
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
import { Spinner } from "@/shared/components/ui/spinner";
import {
  useBackupExportJob,
  useBackupModules,
  useCancelBackupExport,
  useStartBackupExport,
} from "@/shared/lib/api/backup";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";
// Justified http-layer import (no direct http() calls here): BASE_PATH builds
// the artifact download href and HttpError classifies the poll 404 that means
// "job gone"; all requests go through the backup api layer above.
import { BASE_PATH, HttpError } from "@/shared/lib/http";
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

function BackupExportCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  // Blobs are OPT-IN (FIX-053): unchecked exports rows only (`none`),
  // checked adds the separate compressed files archive (`separate`).
  const [includeBlobs, setIncludeBlobs] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const modulesQuery = useBackupModules();
  const modules = modulesQuery.data ?? [];
  const selected = modules.map(m => m.name).filter(name => !excluded.has(name));

  const jobQuery = useBackupExportJob(jobId);
  const job = jobQuery.data;
  // The in-memory job disappears once every artifact has been downloaded
  // (or after a server restart) — both surface as a poll 404.
  const jobGone = jobQuery.error instanceof HttpError && jobQuery.error.status === 404;
  const jobActive = job !== undefined && !jobGone
    && (job.state === "pending" || job.state === "running");

  const generate = useStartBackupExport();
  const cancel = useCancelBackupExport();

  const startExport = () => {
    generate.mutate({ modules: selected, blobs: includeBlobs ? "separate" : "none" }, {
      onSuccess: res => setJobId(res.jobId),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const cancelExport = () => {
    if (jobId === null)
      return;
    cancel.mutate(jobId, {
      onSuccess: () => setJobId(null),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

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
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={includeBlobs}
              disabled={jobActive}
              aria-describedby="backup-include-blobs-help"
              onChange={e => setIncludeBlobs(e.currentTarget.checked)}
            />
            <span className="font-medium">{t("settings:backup.export.includeBlobs")}</span>
          </label>
          <p id="backup-include-blobs-help" className="text-xs text-muted-foreground">
            {t("settings:backup.export.includeBlobsHint")}
          </p>
        </div>

        <Button
          type="button"
          disabled={selected.length === 0 || generate.isPending || jobActive}
          onClick={startExport}
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
            onCancel={cancelExport}
          />
        )}
      </CardContent>
    </Card>
  );
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
      {job.warnings !== null && job.warnings.length > 0 && (
        <div>
          <div className="text-sm font-medium">{t("settings:backup.export.warnings")}</div>
          <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
            {job.warnings.map(warning => <li key={warning} className="break-words">{warning}</li>)}
          </ul>
        </div>
      )}
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
