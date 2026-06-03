import type { ReactNode } from "react";
// Shared data shapes for the drive file-list surface.
//
// The surface is presentational and renders `DisplayItem`s. Consumers fetch
// `DriveEntry`s from the API layer (`@/shared/lib/api/drive`) and bridge them
// with `entryToDisplayItem`. Keeping the adapter here means every consumer
// maps entries identically and the surface never depends on the API client.
import type { DriveEntry } from "@/shared/lib/api/drive";
import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
} from "lucide-react";
import { createElement } from "react";
import { BASE_PATH } from "@/shared/lib/http";

// ── Types ──

export type FileType = "folder" | "pdf" | "image" | "spreadsheet" | "document" | "file";
export type DriveSortBy = "name" | "modified";
export type DriveTypeFilter = "all" | "folders" | "files" | "pdf" | "image" | "document" | "spreadsheet";
export type DriveOwnerFilter = "all" | "me";
export type DriveModifiedFilter = "all" | "today" | "7d" | "30d";
export type DriveSourceFilter = "all" | "current";

/** Owner scope as the surface understands it (team directories render as "team"). */
type DisplayOwnerType = "user" | "team";

export interface DisplayItem {
  readonly id: string;
  readonly name: string;
  readonly type: FileType;
  readonly size?: number;
  readonly modified: string;
  readonly ownerType: DisplayOwnerType;
  readonly ownerId: string;
  readonly owner?: string;
  readonly isFolder: boolean;
  readonly fileId: string | null;
  readonly mimeType?: string;
  readonly thumbnailUrl?: string;
  readonly isFavorite: boolean;
}

// ── Helpers ──

export function detectFileType(mimeType: string): FileType {
  if (mimeType.includes("pdf"))
    return "pdf";
  if (mimeType.startsWith("image/"))
    return "image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv"))
    return "spreadsheet";
  if (mimeType.includes("document") || mimeType.includes("word") || mimeType.includes("text"))
    return "document";
  return "file";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const FILE_ICONS: Record<FileType, (className: string) => ReactNode> = {
  folder: cls => createElement(Folder, { className: `${cls} text-foreground/80` }),
  pdf: cls => createElement(FileText, { className: `${cls} text-red-600/80 dark:text-red-400/80` }),
  image: cls => createElement(FileImage, { className: `${cls} text-teal-600/80 dark:text-teal-400/80` }),
  spreadsheet: cls => createElement(FileSpreadsheet, { className: `${cls} text-emerald-600/80 dark:text-emerald-400/80` }),
  document: cls => createElement(FileText, { className: `${cls} text-blue-600/80 dark:text-blue-400/80` }),
  file: cls => createElement(File, { className: `${cls} text-slate-600/75 dark:text-slate-400/75` }),
};

/**
 * Bridge a backend `DriveEntry` to the presentational `DisplayItem`. Team
 * directory entries collapse to the `"team"` owner scope so the surface can
 * style their folder icons distinctly; the personal drive maps to `"user"`.
 */
export function entryToDisplayItem(entry: DriveEntry): DisplayItem {
  const ownerType: DisplayOwnerType = entry.ownerType === "user" ? "user" : "team";

  if (entry.type === "folder") {
    return {
      id: entry.id,
      name: entry.name,
      type: "folder",
      modified: entry.updatedAt || entry.createdAt,
      ownerType,
      ownerId: entry.ownerId,
      isFolder: true,
      fileId: null,
      isFavorite: entry.favorite,
    };
  }

  return {
    id: entry.id,
    name: entry.name || (entry.file?.filename ?? ""),
    type: entry.file ? detectFileType(entry.file.mimetype) : "file",
    modified: entry.updatedAt || entry.createdAt,
    ownerType,
    ownerId: entry.ownerId,
    isFolder: false,
    fileId: entry.file?.fileId ?? null,
    isFavorite: entry.favorite,
    ...(entry.file
      ? {
          size: entry.file.size,
          mimeType: entry.file.mimetype,
          ...(entry.file.mimetype.startsWith("image/")
            ? { thumbnailUrl: `${BASE_PATH}/api/drive/entries/${encodeURIComponent(entry.id)}/content?inline=true` }
            : {}),
        }
      : {}),
  };
}
