import type { BackupContribution } from "@/modules/backup/registry";
import { fileBlobs, fileReferences, files } from "@/modules/file/schema";

/**
 * Backup contribution for the file module, including the built-in rule-14
 * import transform (PLAN-075): `files` is content-addressed per driver
 * (`UNIQUE(sha256, storage_driver)`), so an incoming row whose PK is new but
 * whose content already exists live is skipped as a duplicate, and incoming
 * `file_references.fileId` values are remapped onto the existing live id.
 * This is also the reference implementation of the transform-hook authoring
 * pattern — see `docs/develop/module/standards.md` §2.8.
 */
export const fileBackupContribution: BackupContribution = {
  name: "files",
  // `files` first so the FK on `file_references.file_id` resolves on restore.
  // `file_blob` carries db-driver file bytes (FEAT-047) — no FK either way,
  // exported so db-stored content travels inside the data archive (FIX-053).
  tables: [files, fileReferences, fileBlobs],
  deps: ["users"],
  importTransforms: [
    {
      fromTable: "files",
      // Content-addressed dedupe is a permanent merge semantic, not a
      // schema-migration shim — it applies to archives of every age.
      appliesTo: () => true,
      apply: (row, ctx) => {
        if (typeof row.sha256 !== "string" || typeof row.storageDriver !== "string")
          return [{ table: "files", row }]; // malformed — let the row pipeline fail it
        if (ctx.lookup("files", { id: row.id }))
          return [{ table: "files", row }]; // PK exists live — plain rule-11 duplicate skip
        const existing = ctx.lookup("files", { sha256: row.sha256, storageDriver: row.storageDriver });
        if (!existing)
          return [{ table: "files", row }];
        // Rule 14: same bytes already live under another id — drop the row,
        // redirect incoming references to the existing one.
        ctx.setMappedId("files", row.id, existing.id);
        ctx.skipAsDuplicate("remapped");
        return [];
      },
    },
    {
      fromTable: "file_references",
      appliesTo: () => true,
      apply: (row, ctx) => {
        const mappedId = ctx.getMappedId("files", row.fileId);
        return [{
          table: "file_references",
          row: mappedId === undefined ? row : { ...row, fileId: mappedId },
        }];
      },
    },
  ],
};
