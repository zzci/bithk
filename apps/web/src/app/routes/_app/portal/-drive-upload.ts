// Drive upload queue: a small global store of in-flight/finished uploads plus
// an XHR-based uploader that reports byte progress (the react-query mutation
// uses fetch, which can't surface upload progress). The bottom-right
// `-drive-upload-panel.tsx` renders this store; FileBrowser and the sidebar
// "+" enqueue through `useDriveUploader`.

import type { DriveOwnerType } from "@/shared/lib/api/drive";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { create } from "zustand";
import { driveKeys } from "@/shared/lib/api/drive";
import { BASE_PATH } from "@/shared/lib/http";

export type UploadStatus = "uploading" | "done" | "error";

export interface UploadTask {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly error?: string | undefined;
}

interface UploadState {
  readonly tasks: readonly UploadTask[];
  readonly add: (task: UploadTask) => void;
  readonly patch: (id: string, patch: Partial<UploadTask>) => void;
  readonly clearFinished: () => void;
}

export const useDriveUploadStore = create<UploadState>(set => ({
  tasks: [],
  add: task => set(state => ({ tasks: [...state.tasks, task] })),
  patch: (id, patch) => set(state => ({
    tasks: state.tasks.map(task => (task.id === id ? { ...task, ...patch } : task)),
  })),
  clearFinished: () => set(state => ({
    tasks: state.tasks.filter(task => task.status === "uploading"),
  })),
}));

export interface UploadOwner {
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
  readonly parentEntryId: string | null;
}

/**
 * Returns an `enqueue(files, owner)` that uploads each file via XHR, tracking
 * byte progress in the queue store and invalidating drive queries on success.
 * Auth mirrors `httpRaw`: cookie credentials + the `X-Requested-With` CSRF
 * header.
 */
export function useDriveUploader(): (files: readonly File[], owner: UploadOwner) => void {
  const queryClient = useQueryClient();
  const add = useDriveUploadStore(state => state.add);
  const patch = useDriveUploadStore(state => state.patch);

  return useCallback((files, owner) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      add({ id, name: file.name, size: file.size, status: "uploading", progress: 0 });

      const form = new FormData();
      form.set("file", file);
      if (owner.parentEntryId)
        form.set("parentEntryId", owner.parentEntryId);
      form.set("ownerType", owner.ownerType);
      form.set("ownerId", owner.ownerId);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable)
          patch(id, { progress: Math.round((event.loaded / event.total) * 100) });
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          patch(id, { status: "done", progress: 100 });
          void queryClient.invalidateQueries({ queryKey: driveKeys.all });
        }
        else {
          patch(id, { status: "error", error: `HTTP ${xhr.status}` });
        }
      });
      xhr.addEventListener("error", () => patch(id, { status: "error", error: "network" }));
      xhr.open("POST", `${BASE_PATH}/api/drive/files/upload`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      xhr.send(form);
    }
  }, [add, patch, queryClient]);
}
