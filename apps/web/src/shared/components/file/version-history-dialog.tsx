import type { DriveEntry } from "@/shared/lib/api/drive";
import { Check, History, Pin, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { useClearDisplayVersion, useEntryVersions, useSetDisplayVersion } from "@/shared/lib/api/drive";
import { formatBytes } from "@/shared/lib/format";

export function DriveVersionHistoryDialog({
  entry,
  open,
  onOpenChange,
  readOnly = false,
  onSwitched,
}: {
  readonly entry: DriveEntry | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readOnly?: boolean;
  /** Fired after the display version is set or cleared (refresh the editor). */
  readonly onSwitched?: () => void;
}) {
  const { t } = useTranslation("drive");
  const versionsQuery = useEntryVersions(open ? entry?.id : undefined);
  const setDisplayVersion = useSetDisplayVersion();
  const clearDisplayVersion = useClearDisplayVersion();
  const versions = versionsQuery.data ?? [];
  const pending = setDisplayVersion.isPending || clearDisplayVersion.isPending;
  // Only offer "use latest" when the current display is an older, pinned version
  // (the newest version is always first in the ULID-desc list).
  const latestIsCurrent = versions[0]?.isCurrent ?? true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            {t("versions.title")}
          </DialogTitle>
          <DialogDescription>{entry ? t("versions.description", { name: entry.name }) : ""}</DialogDescription>
        </DialogHeader>

        {!readOnly && !latestIsCurrent && entry && (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("versions.pinnedHint")}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                const options = onSwitched ? { onSuccess: onSwitched } : undefined;
                clearDisplayVersion.mutate({ entryId: entry.id }, options);
              }}
            >
              <RotateCcw className="size-4" />
              {t("versions.useLatest")}
            </Button>
          </div>
        )}

        <div className="max-h-[56vh] overflow-auto rounded-md border">
          {versionsQuery.isLoading && (
            <div className="p-4 text-sm text-muted-foreground">{t("common.loading")}</div>
          )}
          {!versionsQuery.isLoading && versions.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">{t("versions.empty")}</div>
          )}
          {versions.map(version => (
            <div key={version.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
                {version.versionNo}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{version.filename}</span>
                  {version.isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                      <Check className="size-3" />
                      {t("versions.current")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatBytes(version.size)}
                  {" · "}
                  {new Date(version.createdAt).toLocaleString()}
                  {" · "}
                  {version.uploadedBy}
                </p>
              </div>
              {!readOnly && !version.isCurrent && entry && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    const options = onSwitched ? { onSuccess: onSwitched } : undefined;
                    setDisplayVersion.mutate({ entryId: entry.id, versionId: version.id }, options);
                  }}
                >
                  <Pin className="size-4" />
                  {t("versions.setDisplay")}
                </Button>
              )}
            </div>
          ))}
        </div>

        {versionsQuery.error && <p className="text-sm text-destructive">{versionsQuery.error.message}</p>}
        {setDisplayVersion.error && <p className="text-sm text-destructive">{setDisplayVersion.error.message}</p>}
        {clearDisplayVersion.error && <p className="text-sm text-destructive">{clearDisplayVersion.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
