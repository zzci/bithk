// Bottom-right upload queue panel. Reads the global file upload store and
// shows per-file progress grouped by folder, plus an overall summary;
// collapsible, dismissable once everything settles.

import type { UploadTask } from "./upload-queue";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Folder,
  X,
} from "lucide-react";
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatBytes } from "@/shared/lib/format";
import { useFileUploadStore } from "./upload-queue";

/** Top-level folder a task belongs to, or null when it is a loose file. */
function folderOf(task: UploadTask): string | null {
  const path = task.relativePath;
  if (path && path.includes("/"))
    return path.split("/")[0] ?? null;
  return null;
}

function avgProgress(tasks: readonly UploadTask[]): number {
  return tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
    : 0;
}

function TaskRow({ task }: { readonly task: UploadTask }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
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
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function FolderGroup({ name, tasks }: { readonly name: string; readonly tasks: readonly UploadTask[] }) {
  const { t } = useTranslation("common");
  const aggregate = avgProgress(tasks);
  return (
    <div>
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5">
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-2xs font-medium">{name}</span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t("upload.folderFiles", { count: tasks.length })}
        </span>
        <span className="shrink-0 text-2xs font-medium text-primary">{`${aggregate}%`}</span>
      </div>
      <div className="h-1 w-full overflow-hidden bg-muted">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${aggregate}%` }} />
      </div>
      <div className="divide-y">
        {tasks.map(task => <TaskRow key={task.id} task={task} />)}
      </div>
    </div>
  );
}

export function UploadQueuePanel() {
  const { t } = useTranslation("common");
  const tasks = useFileUploadStore(state => state.tasks);
  const preparing = useFileUploadStore(state => state.preparing);
  const clearFinished = useFileUploadStore(state => state.clearFinished);
  const [open, setOpen] = useState(true);

  if (tasks.length === 0 && !preparing)
    return null;

  const uploading = preparing || tasks.some(task => task.status === "uploading");
  const done = tasks.filter(task => task.status === "done").length;
  const total = tasks.length;
  const overall = total ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / total) : 0;

  const groups = new Map<string, UploadTask[]>();
  const loose: UploadTask[] = [];
  for (const task of tasks) {
    const folder = folderOf(task);
    if (folder === null) {
      loose.push(task);
      continue;
    }
    const group = groups.get(folder);
    if (group)
      group.push(task);
    else
      groups.set(folder, [task]);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-background shadow-lg">
      <div className="border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            {uploading
              ? t("upload.progress", { done, total })
              : t("upload.complete")}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setOpen(value => !value)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={open ? t("upload.collapse") : t("upload.expand")}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </Button>
            {!uploading && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={clearFinished}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("upload.dismiss")}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {uploading && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${overall}%` }}
            />
          </div>
        )}
      </div>

      {open && (
        <div className="max-h-48 divide-y overflow-auto">
          {preparing && (
            <div className="flex items-center gap-2.5 px-3 py-2">
              <div className="shrink-0">
                <Spinner className="text-primary" />
              </div>
              <p className="truncate text-xs text-muted-foreground">{t("upload.preparing")}</p>
            </div>
          )}
          {[...groups].map(([name, groupTasks]) => (
            <FolderGroup key={name} name={name} tasks={groupTasks} />
          ))}
          {loose.map(task => <TaskRow key={task.id} task={task} />)}
        </div>
      )}
    </div>
  );
}
