import { and, eq } from "drizzle-orm";
import { registerFilePermissionHook } from "@/modules/file";
import { driveEntries } from "./schema";

registerFilePermissionHook("drive_entry", {
  canRead: async (db, actor, ref) => {
    if (actor.role === "admin")
      return true;
    const row = await db
      .select({ id: driveEntries.id })
      .from(driveEntries)
      .where(and(
        eq(driveEntries.id, ref.ownerId),
        eq(driveEntries.ownerType, "user"),
        eq(driveEntries.ownerId, actor.id),
      ))
      .get();
    return row !== undefined;
  },
  canDelete: async (db, actor, ref) => {
    if (actor.role === "admin")
      return true;
    const row = await db
      .select({ id: driveEntries.id })
      .from(driveEntries)
      .where(and(
        eq(driveEntries.id, ref.ownerId),
        eq(driveEntries.ownerType, "user"),
        eq(driveEntries.ownerId, actor.id),
      ))
      .get();
    return row !== undefined;
  },
});
