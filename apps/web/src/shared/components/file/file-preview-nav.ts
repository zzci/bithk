// Sibling navigation for the preview dialog: which entries of a listing can be
// stepped through, and what comes next. Kept apart from the dialog so the
// sequence rules stay unit-testable without pulling in pdfjs / CodeMirror.

import type { DriveEntry } from "@/shared/lib/api/drive";

import { isUniverSheetEntry } from "@/shared/lib/api/drive";

import { resolvePreviewKind } from "./file-preview-types";

/**
 * Entries of a listing the preview dialog can step through, in list order.
 * Folders have no bytes, Univer spreadsheets open in their own editor, and
 * unsupported kinds would only show the download card.
 */
export function previewableSiblings(entries: readonly DriveEntry[]): readonly DriveEntry[] {
  return entries.filter((entry) => {
    const file = entry.file;
    if (!file || entry.type !== "file" || isUniverSheetEntry(entry))
      return false;
    return resolvePreviewKind(file.mimetype, file.filename) !== "unsupported";
  });
}

/**
 * Neighbour of `currentId` at `offset`, or `null` at either end and when the
 * current entry is not part of the sequence.
 */
export function siblingAt(
  siblings: readonly DriveEntry[],
  currentId: string,
  offset: number,
): DriveEntry | null {
  const index = siblings.findIndex(entry => entry.id === currentId);
  if (index < 0)
    return null;
  return siblings[index + offset] ?? null;
}
