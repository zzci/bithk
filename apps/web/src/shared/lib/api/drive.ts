import type { UseMutationResult } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { httpRaw } from "../http";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
}

export interface DriveEntry {
  readonly id: string;
  readonly ownerUserId: string;
  readonly parentEntryId: string | null;
  readonly type: "folder" | "file";
  readonly name: string;
  readonly favorite: boolean;
  readonly status: "normal" | "trash";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly file: {
    readonly referenceId: string;
    readonly fileId: string;
    readonly filename: string;
    readonly mimetype: string;
    readonly size: number;
  } | null;
}

export const driveKeys = {
  all: ["drive"] as const,
  entries: (parentEntryId: string | null, status: "normal" | "trash") => ["drive", "entries", parentEntryId ?? "root", status] as const,
};

async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await httpRaw(path, init);
  return (await res.json()) as T;
}

function entriesPath(parentEntryId: string | null, status: "normal" | "trash"): string {
  const params = new URLSearchParams();
  params.set("status", status);
  if (parentEntryId)
    params.set("parentEntryId", parentEntryId);
  return `/drive/entries?${params.toString()}`;
}

export function useDriveEntries(parentEntryId: string | null, status: "normal" | "trash") {
  return useQuery({
    queryKey: driveKeys.entries(parentEntryId, status),
    queryFn: () => rawJson<ApiEnvelope<readonly DriveEntry[]>>(entriesPath(parentEntryId, status)).then(r => r.data),
    staleTime: 5_000,
  });
}

export function useCreateDriveFolder(): UseMutationResult<DriveEntry, Error, { name: string; parentEntryId: string | null }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payload => rawJson<ApiEnvelope<DriveEntry>>("/drive/folders", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useUploadDriveFile(): UseMutationResult<DriveEntry, Error, { file: File; parentEntryId: string | null }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, parentEntryId }) => {
      const form = new FormData();
      form.set("file", file);
      if (parentEntryId)
        form.set("parentEntryId", parentEntryId);
      const body = await rawJson<ApiEnvelope<DriveEntry>>("/drive/files/upload", {
        method: "POST",
        body: form,
      });
      return body.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useUpdateDriveEntry(): UseMutationResult<DriveEntry, Error, {
  id: string;
  name?: string;
  parentEntryId?: string | null;
  favorite?: boolean;
}> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => rawJson<ApiEnvelope<DriveEntry>>(`/drive/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useTrashDriveEntry(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/entries/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useRestoreDriveEntry(): UseMutationResult<DriveEntry, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<DriveEntry>>(`/drive/entries/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export function useDeleteDriveEntryPermanently(): UseMutationResult<{ readonly id: string }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: id => rawJson<ApiEnvelope<{ readonly id: string }>>(`/drive/entries/${encodeURIComponent(id)}/permanent`, {
      method: "DELETE",
    }).then(r => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: driveKeys.all }),
  });
}

export async function downloadDriveEntry(entry: DriveEntry): Promise<void> {
  if (!entry.file)
    return;
  const res = await httpRaw(`/drive/entries/${encodeURIComponent(entry.id)}/content`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = entry.name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
