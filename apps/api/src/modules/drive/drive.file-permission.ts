import type { AppDatabase } from "@/db";
import { eq } from "drizzle-orm";
import { registerFilePermissionHook } from "@/modules/file";
import { resolveEntryCapabilities } from "./drive.permission";
import { driveEntries } from "./schema";

/**
 * Load the owner-identifying columns of the drive entry a `file_references`
 * row points at. For `drive_entry`-owned files the reference's `ownerId` is
 * the `drive_entries.id` (see `uploadDriveFile`).
 */
async function loadEntryOwner(db: AppDatabase, entryId: string) {
  return db
    .select({ id: driveEntries.id, ownerType: driveEntries.ownerType, ownerId: driveEntries.ownerId })
    .from(driveEntries)
    .where(eq(driveEntries.id, entryId))
    .get();
}

// The generic `/files` routes ask this hook whether the actor may read /
// delete a `drive_entry`-backed file. Delegate to `resolveEntryCapabilities`
// so team-directory, project and direct-share derived access is honored the
// same way the drive routes honor it — not just direct personal ownership.
// (Admin bypass lives inside `resolveEntryCapabilities`.)
registerFilePermissionHook("drive_entry", {
  canRead: async (db, actor, ref) => {
    const entry = await loadEntryOwner(db, ref.ownerId);
    if (!entry)
      return false;
    const caps = await resolveEntryCapabilities(db, entry, actor);
    return caps.has("read");
  },
  canDelete: async (db, actor, ref) => {
    const entry = await loadEntryOwner(db, ref.ownerId);
    if (!entry)
      return false;
    const caps = await resolveEntryCapabilities(db, entry, actor);
    return caps.has("delete");
  },
});
