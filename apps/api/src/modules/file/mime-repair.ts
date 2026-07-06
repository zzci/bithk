import type { AppDatabase } from "@/db";
import { and, desc, eq, ne } from "drizzle-orm";
import { driveFileVersions } from "@/modules/drive/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { mimeFromFilename } from "@/shared/lib/mime-sniff";

export interface MimeRepairResult {
  /** `files` rows found with an empty mimetype. */
  readonly scanned: number;
  /** Rows whose mimetype was resolved and backfilled. */
  readonly repaired: number;
}

/**
 * Idempotent boot repair for `files.mimetype = ''` rows (FIX-063). Bun's
 * server-side multipart parsing dropped the part `Content-Type`, so every
 * pre-fix multipart upload stored an empty mimetype — which breaks
 * mime-keyed detection (Univer sheets became unopenable). For each empty
 * row, infer the type from a sibling version of the same drive entry (a
 * version of a sheet is a sheet), else from the reference filename's
 * extension. Unresolvable rows are left empty for a later, smarter pass.
 *
 * Cheap by construction: the scan is a single `WHERE mimetype = ''` query
 * that returns nothing once history is healed.
 */
export async function repairEmptyFileMimetypes(db: AppDatabase): Promise<MimeRepairResult> {
  const empty = await db.select({ id: files.id }).from(files).where(eq(files.mimetype, "")).all();
  let repaired = 0;
  for (const row of empty) {
    const refs = await db
      .select({ ownerType: fileReferences.ownerType, ownerId: fileReferences.ownerId, filename: fileReferences.filename })
      .from(fileReferences)
      .where(eq(fileReferences.fileId, row.id))
      .all();
    const resolved = await inferFromSiblingVersions(db, refs) ?? inferFromFilenames(refs);
    if (resolved) {
      await db.update(files).set({ mimetype: resolved }).where(eq(files.id, row.id)).run();
      repaired++;
    }
  }
  return { scanned: empty.length, repaired };
}

/**
 * The newest non-empty mimetype among other versions of the same drive
 * entry. Only `drive_entry` references have version siblings; attachment
 * references fall through to the filename map.
 */
async function inferFromSiblingVersions(
  db: AppDatabase,
  refs: readonly { ownerType: string; ownerId: string }[],
): Promise<string | null> {
  for (const ref of refs) {
    if (ref.ownerType !== "drive_entry")
      continue;
    const sibling = await db
      .select({ mimetype: files.mimetype })
      .from(driveFileVersions)
      .innerJoin(fileReferences, eq(driveFileVersions.fileReferenceId, fileReferences.id))
      .innerJoin(files, eq(fileReferences.fileId, files.id))
      .where(and(
        eq(driveFileVersions.driveEntryId, ref.ownerId),
        ne(files.mimetype, ""),
      ))
      .orderBy(desc(driveFileVersions.id))
      .get();
    if (sibling)
      return sibling.mimetype;
  }
  return null;
}

function inferFromFilenames(refs: readonly { filename: string }[]): string | null {
  for (const ref of refs) {
    const resolved = mimeFromFilename(ref.filename);
    if (resolved)
      return resolved;
  }
  return null;
}
