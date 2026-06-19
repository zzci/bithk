// Bottom-right upload queue panel. Reads the global file upload store and
// shows per-file progress; collapsible, dismissable once everything settles.

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatBytes } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { useFileUploadStore } from "./upload-queue";

export function UploadQueuePanel() {
  const { t } = useTranslation("drive");
  const tasks = useFileUploadStore(state => state.tasks);
  const clearFinished = useFileUploadStore(state => state.clearFinished);
  const [open, setOpen] = useState(true);

  if (tasks.length === 0)
    return null;

  const uploading = tasks.some(task => task.status === "uploading");
  const done = tasks.filter(task => task.status === "done").length;

  return (
    <div className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">
          {uploading
            ? t("browser.uploadProgress", { done, total: tasks.length })
            : t("browser.uploadComplete")}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setOpen(value => !value)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={open ? t("browser.collapse") : t("browser.expand")}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
          {!uploading && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={clearFinished}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("browser.uploadDismiss")}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="max-h-48 divide-y overflow-auto">
          {tasks.map(task => (
            <div key={task.id} className="flex items-center gap-2.5 px-3 py-2">
              <div className="shrink-0">
                {task.status === "uploading" && <Spinner className="text-primary" />}
                {task.status === "done" && <CheckCircle2 className="size-4 text-success" />}
                {task.status === "error" && <AlertCircle className="size-4 text-destructive" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">{task.name}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground">{formatBytes(task.size)}</span>
                  {task.status === "uploading" && (
                    <span className="text-2xs font-medium text-primary">{`${task.progress}%`}</span>
                  )}
                  {task.status === "error" && (
                    <span className="text-2xs text-destructive">{task.error}</span>
                  )}
                </div>
                {task.status === "uploading" && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full bg-primary transition-all duration-300")}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
