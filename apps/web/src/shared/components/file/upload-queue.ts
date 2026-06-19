// File upload queue: a small global store of in-flight/finished uploads plus
// an XHR-based uploader that reports byte progress (the react-query mutation
// uses fetch, which can't surface upload progress). The bottom-right
// `upload-queue-panel.tsx` renders this store; FileBrowser and the sidebar
// "+" enqueue through `useFileUploader`.

import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { create } from "zustand";
import { driveKeys } from "@/shared/lib/api/drive";
import { BASE_PATH } from "@/shared/lib/http";

type UploadStatus = "uploading" | "done" | "error";

export interface UploadTask {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly relativePath?: string | undefined;
  readonly error?: string | undefined;
}

interface UploadState {
  readonly tasks: readonly UploadTask[];
  readonly preparing: boolean;
  readonly add: (task: UploadTask) => void;
  readonly patch: (id: string, patch: Partial<UploadTask>) => void;
  readonly setPreparing: (v: boolean) => void;
  readonly clearFinished: () => void;
}

export const useFileUploadStore = create<UploadState>(set => ({
  tasks: [],
  preparing: false,
  add: task => set(state => ({ tasks: [...state.tasks, task] })),
  patch: (id, patch) => set(state => ({
    tasks: state.tasks.map(task => (task.id === id ? { ...task, ...patch } : task)),
  })),
  setPreparing: v => set({ preparing: v }),
  clearFinished: () => set(state => ({
    tasks: state.tasks.filter(task => task.status === "uploading"),
  })),
}));

interface UploadOwner {
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
export function useFileUploader(): (files: readonly File[], owner: UploadOwner) => void {
  const queryClient = useQueryClient();
  const add = useFileUploadStore(state => state.add);
  const patch = useFileUploadStore(state => state.patch);
  const setPreparing = useFileUploadStore(state => state.setPreparing);

  return useCallback((files, owner) => {
    const uploadOne = (file: File, parentEntryId: string | null) => new Promise<void>((resolve) => {
      const id = crypto.randomUUID();
      add({ id, name: file.name, size: file.size, status: "uploading", progress: 0, relativePath: relativePathOf(file) });

      const form = new FormData();
      form.set("file", file);
      if (parentEntryId)
        form.set("parentEntryId", parentEntryId);
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
          resolve();
        }
        else {
          patch(id, { status: "error", error: `HTTP ${xhr.status}` });
          resolve();
        }
      });
      xhr.addEventListener("error", () => {
        patch(id, { status: "error", error: "network" });
        resolve();
      });
      xhr.open("POST", `${BASE_PATH}/api/drive/files/upload`);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      xhr.send(form);
    });

    const folderFiles = files.filter(file => relativePathOf(file).includes("/"));
    const plainFiles = files.filter(file => !relativePathOf(file).includes("/"));

    for (const file of plainFiles)
      void uploadOne(file, owner.parentEntryId);

    if (folderFiles.length > 0) {
      setPreparing(true);
      void (async () => {
        try {
          const folderCache = new Map<string, string | null>([["", owner.parentEntryId]]);
          for (const file of folderFiles) {
            try {
              const path = relativePathOf(file);
              const parts = path.split("/").filter(Boolean);
              const folders = parts.slice(0, -1);
              const parentEntryId = await ensureFolderPath(owner, folders, folderCache);
              await uploadOne(file, parentEntryId);
            }
            catch (err) {
              add({
                id: crypto.randomUUID(),
                name: file.name,
                size: file.size,
                status: "error",
                progress: 0,
                relativePath: relativePathOf(file),
                error: err instanceof Error ? err.message : "folder",
              });
            }
          }
        }
        finally {
          setPreparing(false);
        }
      })();
    }
  }, [add, patch, setPreparing, queryClient]);
}

function relativePathOf(file: File): string {
  return (file as File & { readonly webkitRelativePath?: string }).webkitRelativePath || file.name;
}

async function ensureFolderPath(
  owner: UploadOwner,
  folders: readonly string[],
  folderCache: Map<string, string | null>,
): Promise<string | null> {
  let parentEntryId = owner.parentEntryId;
  let key = "";

  for (const folderName of folders) {
    key = key ? `${key}/${folderName}` : folderName;
    if (folderCache.has(key)) {
      parentEntryId = folderCache.get(key) ?? null;
      continue;
    }

    const existing = await findFolder(owner, parentEntryId, folderName);
    if (existing) {
      parentEntryId = existing.id;
      folderCache.set(key, parentEntryId);
      continue;
    }

    const created = await createFolder(owner, parentEntryId, folderName);
    parentEntryId = created.id;
    folderCache.set(key, parentEntryId);
  }

  return parentEntryId;
}

async function findFolder(owner: UploadOwner, parentEntryId: string | null, name: string): Promise<DriveEntry | null> {
  const params = new URLSearchParams();
  params.set("status", "normal");
  params.set("ownerType", owner.ownerType);
  params.set("ownerId", owner.ownerId);
  if (parentEntryId)
    params.set("parentEntryId", parentEntryId);
  const res = await fetch(`${BASE_PATH}/api/drive/entries?${params.toString()}`, { credentials: "include" });
  if (!res.ok)
    return null;
  const body = await res.json() as { readonly data?: readonly DriveEntry[] };
  return (body.data ?? []).find(entry => entry.type === "folder" && entry.name === name) ?? null;
}

async function createFolder(owner: UploadOwner, parentEntryId: string | null, name: string): Promise<DriveEntry> {
  const res = await fetch(`${BASE_PATH}/api/drive/folders`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      name,
      parentEntryId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
    }),
  });
  const body = await res.json() as { readonly data?: DriveEntry };
  if (!res.ok || !body.data)
    throw new Error(`Could not create folder ${name}`);
  return body.data;
}
