// Backup v2 import card (PLAN-075 Phase 5 + R7 + FIX-062): archive upload →
// dry-run report → explicit confirm (merge, optionally wipe-first) → apply
// poll → final result report, plus the standalone blob-restore affordance
// for legacy `blobs.tar.gz` artifacts and the quarantine rescan button
// (path-correspondence heal after copying the storage tree/bucket).
import type { BlobRescanReport, BlobRestoreReport } from "@/shared/lib/api/backup";
import { RefreshCw, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileUploadButton } from "@/shared/components/file";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Spinner } from "@/shared/components/ui/spinner";
import { Switch } from "@/shared/components/ui/switch";
import {
  useApplyBackupImport,
  useBackupImportJob,
  useBlobRescan,
  useDiscardBackupImport,
  useRestoreBlobArchive,
  useUploadBackupImport,
} from "@/shared/lib/api/backup";
import { errorMessage } from "@/shared/lib/errors";
import { BlobRestoreReportView, ImportReportView } from "./-settings-backup-report";

const ARCHIVE_ACCEPT = ".tar.gz,application/gzip";

export function BackupImportCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [importId, setImportId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const importQuery = useBackupImportJob(importId);
  const job = importQuery.data;

  const upload = useUploadBackupImport();
  const apply = useApplyBackupImport();
  const discard = useDiscardBackupImport();

  const uploadArchive = (file: File) => {
    upload.mutate(file, {
      onSuccess: res => setImportId(res.importId),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const applyImport = (wipeExisting: boolean) => {
    if (importId === null)
      return;
    apply.mutate({ importId, ...(wipeExisting ? { wipeExisting } : {}) }, {
      onSuccess: () => setConfirmOpen(false),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const discardImport = () => {
    if (importId === null)
      return;
    discard.mutate(importId, { onSuccess: () => setImportId(null) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings:backup.import.title")}</CardTitle>
        <CardDescription>{t("settings:backup.import.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {importId === null && (
          <FileUploadButton
            acceptOverride={ARCHIVE_ACCEPT}
            disabled={upload.isPending}
            onSelect={files => files[0] && uploadArchive(files[0])}
          >
            <Button type="button" variant="outline" disabled={upload.isPending}>
              <Upload />
              {upload.isPending
                ? t("settings:backup.import.uploading")
                : t("settings:backup.import.upload")}
            </Button>
          </FileUploadButton>
        )}

        {importQuery.error !== null && importId !== null && (
          <ErrorBanner message={errorMessage(importQuery.error, t("common:common.error.loadFailed"))} />
        )}

        {job && (
          <div className="space-y-4">
            {job.state === "failed" && (
              <ErrorBanner message={`${t("settings:backup.import.stateFailed")}: ${job.error ?? ""}`} />
            )}

            {job.state === "completed" && job.result
              ? <ImportReportView title={t("settings:backup.import.resultTitle")} report={job.result} />
              : <ImportReportView title={t("settings:backup.import.dryRunTitle")} report={job.report} />}

            {job.state === "applying" && (
              <div className="flex items-center gap-2 text-sm font-medium">
                <Spinner className="size-4" />
                {t("settings:backup.import.stateApplying")}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {job.state === "validated" && (
                <Button type="button" onClick={() => setConfirmOpen(true)}>
                  {t("settings:backup.import.apply")}
                </Button>
              )}
              {job.state !== "applying" && (
                <Button type="button" variant="outline" disabled={discard.isPending} onClick={discardImport}>
                  {t("settings:backup.import.discard")}
                </Button>
              )}
            </div>
          </div>
        )}

        <ApplyConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          pending={apply.isPending}
          onConfirm={applyImport}
        />

        <Separator />

        <BlobRecoverySection />
      </CardContent>
    </Card>
  );
}

// ─── Apply confirm dialog (merge; optional destructive wipe-first) ────────

function ApplyConfirmDialog({ open, onOpenChange, pending, onConfirm }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onConfirm: (wipeExisting: boolean) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [wipeExisting, setWipeExisting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // Wipe-first deletes every live row: same type-to-confirm gate replace had.
  const keyword = t("settings:backup.import.wipeKeyword");
  const destructiveConfirmed = confirmText.trim().toLowerCase() === keyword.toLowerCase();
  const canConfirm = !pending && (!wipeExisting || destructiveConfirmed);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setWipeExisting(false);
      setConfirmText("");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settings:backup.import.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("settings:backup.import.confirmDescription")}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="backup-wipe-existing">{t("settings:backup.import.wipeExisting")}</Label>
          <Switch
            id="backup-wipe-existing"
            checked={wipeExisting}
            onCheckedChange={setWipeExisting}
          />
        </div>

        {wipeExisting && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-destructive">
              {t("settings:backup.import.wipeWarning")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="backup-destructive-confirm">
                {t("settings:backup.import.typeToConfirm", { keyword })}
              </Label>
              <Input
                id="backup-destructive-confirm"
                value={confirmText}
                autoComplete="off"
                onChange={e => setConfirmText(e.currentTarget.value)}
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogClose render={<Button type="button" variant="outline">{t("common:common.cancel")}</Button>} />
          <Button
            type="button"
            variant={wipeExisting ? "destructive" : "default"}
            disabled={!canConfirm}
            onClick={() => onConfirm(wipeExisting)}
          >
            {t("settings:backup.import.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Blob recovery: legacy blobs.tar.gz restore + quarantine rescan ───────

function BlobRecoverySection() {
  const { t } = useTranslation(["settings", "common"]);
  const [report, setReport] = useState<BlobRestoreReport | null>(null);
  const [rescanReport, setRescanReport] = useState<BlobRescanReport | null>(null);

  const restore = useRestoreBlobArchive();
  const rescan = useBlobRescan();

  const restoreArchive = (file: File) => {
    restore.mutate(file, {
      onSuccess: res => setReport(res.report),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  const runRescan = () => {
    rescan.mutate(undefined, {
      onSuccess: res => setRescanReport(res.report),
      onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t("settings:backup.import.blobRescanTitle")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings:backup.import.blobRescanDescription")}</p>
      </div>
      <Button type="button" variant="outline" disabled={rescan.isPending} onClick={runRescan}>
        <RefreshCw />
        {rescan.isPending
          ? t("settings:backup.import.blobRescanRunning")
          : t("settings:backup.import.blobRescan")}
      </Button>
      {rescanReport && (
        <p className="text-sm text-muted-foreground">
          {t("settings:backup.import.blobRescanResult", {
            scanned: rescanReport.scanned,
            healed: rescanReport.healed,
            stillMissing: rescanReport.stillMissing,
          })}
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold">{t("settings:backup.import.blobRestoreTitle")}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings:backup.import.blobRestoreDescription")}</p>
      </div>
      <FileUploadButton
        acceptOverride={ARCHIVE_ACCEPT}
        disabled={restore.isPending}
        onSelect={files => files[0] && restoreArchive(files[0])}
      >
        <Button type="button" variant="outline" disabled={restore.isPending}>
          <Upload />
          {restore.isPending
            ? t("settings:backup.import.blobRestoreUploading")
            : t("settings:backup.import.blobRestoreUpload")}
        </Button>
      </FileUploadButton>
      {report && <BlobRestoreReportView report={report} />}
    </div>
  );
}
