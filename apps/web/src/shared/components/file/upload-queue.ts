// File upload queue: a small global store of in-flight/finished uploads plus
// an XHR-based uploader that reports byte progress (the react-query mutation
// uses fetch, which can't surface upload progress). The bottom-right
// `upload-queue-panel.tsx` renders this store; FileBrowser and the sidebar
// "+" enqueue through `useFileUploader`.

import type { DriveEntry, DriveOwnerType } from "@/shared/lib/api/drive";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { create } from "zustand";
import { useUploadLimits } from "@/shared/hooks/use-upload-limits";
import { driveKeys } from "@/shared/lib/api/drive";
import { sha256Hex } from "@/shared/lib/direct-upload";
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
  const { directUpload } = useUploadLimits();

  return useCallback((files, owner) => {
    // Stream bytes straight to the API (local driver) — multipart POST onto
    // an already-registered queue task. Also the fallback leg when a direct
    // upload fails partway.
    const uploadViaApiTask = (id: string, file: File, parentEntryId: string | null) => new Promise<void>((resolve) => {
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

    const uploadViaApi = (file: File, parentEntryId: string | null) => {
      const id = crypto.randomUUID();
      add({ id, name: file.name, size: file.size, status: "uploading", progress: 0, relativePath: relativePathOf(file) });
      return uploadViaApiTask(id, file, parentEntryId);
    };

    // Presigned direct upload (FEAT-044): hash → presign (dedup-skip) → PUT
    // straight to S3 (progress) → confirm. Any step failure falls back to
    // the multipart API path on the SAME queue task, so an upload is never
    // lost to S3/CORS trouble (FIX-064).
    const uploadDirect = (file: File, parentEntryId: string | null) => new Promise<void>((resolve) => {
      const id = crypto.randomUUID();
      add({ id, name: file.name, size: file.size, status: "uploading", progress: 0, relativePath: relativePathOf(file) });
      const mimetype = file.type || "application/octet-stream";
      const ownerFields = { name: file.name, parentEntryId, ownerType: owner.ownerType, ownerId: owner.ownerId };
      const fallback = () => {
        patch(id, { progress: 0 });
        void uploadViaApiTask(id, file, parentEntryId).then(resolve);
      };

      void (async () => {
        try {
          const sha256 = await sha256Hex(file);
          const presign = await postJson("/api/drive/files/presign-upload", { sha256, size: file.size, mimetype, ...ownerFields });
          if (!presign.ok) {
            fallback();
            return;
          }
          const data = (presign.body as { data: PresignResponse }).data;
          if (data.mode === "done") {
            patch(id, { status: "done", progress: 100 });
            void queryClient.invalidateQueries({ queryKey: driveKeys.all });
            resolve();
            return;
          }
          await putToStorage(data.upload, file, p => patch(id, { progress: p }));
          const confirm = await postJson("/api/drive/files/confirm-upload", { sha256, mimetype, ...ownerFields });
          if (!confirm.ok) {
            fallback();
            return;
          }
          patch(id, { status: "done", progress: 100 });
          void queryClient.invalidateQueries({ queryKey: driveKeys.all });
          resolve();
        }
        catch {
          fallback();
        }
      })();
    });

    const uploadOne = directUpload ? uploadDirect : uploadViaApi;

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
  }, [add, patch, setPreparing, queryClient, directUpload]);
}

interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Record<string, string>;
}

type PresignResponse
  = | { readonly mode: "done"; readonly entry: DriveEntry }
    | { readonly mode: "upload"; readonly upload: PresignedUpload };

/** Same-origin JSON POST to the drive API with cookie + CSRF header. */
async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}

/** PUT the file's bytes directly to the presigned (cross-origin) storage URL. */
function putToStorage(upload: PresignedUpload, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300)
        resolve();
      else
        reject(new Error(`HTTP ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("network")));
    xhr.open(upload.method, upload.url);
    // Cross-origin presigned URL carries its own auth — no cookies, only the
    // signed headers (Content-Type).
    for (const [k, v] of Object.entries(upload.headers))
      xhr.setRequestHeader(k, v);
    xhr.send(file);
  });
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
