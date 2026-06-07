import type { DriveEntry } from "@/shared/lib/api/drive";
import { Check, History, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { useEntryVersions, useSwitchVersion } from "@/shared/lib/api/drive";
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
  readonly onSwitched?: () => void;
}) {
  const { t } = useTranslation("drive");
  const versionsQuery = useEntryVersions(open ? entry?.id : undefined);
  const switchVersion = useSwitchVersion();
  const versions = versionsQuery.data ?? [];

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
                  disabled={switchVersion.isPending}
                  onClick={() => {
                    const options = onSwitched ? { onSuccess: onSwitched } : undefined;
                    switchVersion.mutate({ entryId: entry.id, versionId: version.id }, options);
                  }}
                >
                  <RotateCcw className="size-4" />
                  {t("versions.switch")}
                </Button>
              )}
            </div>
          ))}
        </div>

        {versionsQuery.error && <p className="text-sm text-destructive">{versionsQuery.error.message}</p>}
        {switchVersion.error && <p className="text-sm text-destructive">{switchVersion.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
