import type { PolicyContext } from "@/modules/policy";
import { and, eq } from "drizzle-orm";
import { defineResource } from "@/modules/policy";
import { driveEntries } from "./schema";

type DriveAction
  = | "drive:read"
    | "drive:update"
    | "drive:delete"
    | "drive:download";

export const driveAccess = defineResource<DriveAction>({
  name: "drive",
  namespace: "drive_entry",
  description: "Personal drive entries",
  actions: {
    "drive:read": "viewer",
    "drive:update": "editor",
    "drive:delete": "owner",
    "drive:download": "viewer",
  },
  routes: [
    { method: "GET", path: "/drive/entries/:id", action: "drive:read" },
    { method: "GET", path: "/drive/entries/:id/content", action: "drive:download" },
    { method: "PATCH", path: "/drive/entries/:id", action: "drive:update" },
    { method: "POST", path: "/drive/entries/:id/restore", action: "drive:update" },
    { method: "DELETE", path: "/drive/entries/:id", action: "drive:delete" },
    { method: "DELETE", path: "/drive/entries/:id/permanent", action: "drive:delete" },
  ],
  hooks: {
    bypass: async (ctx, _action, objectId) => ownsDriveEntry(ctx, objectId),
    resolveEntity: async (db, objectId) => {
      const row = await db
        .select({ id: driveEntries.id, name: driveEntries.name })
        .from(driveEntries)
        .where(eq(driveEntries.id, objectId))
        .get();
      return row ? { name: row.name, type: "drive_entry", url: `/portal/drive` } : null;
    },
  },
});

async function ownsDriveEntry(ctx: PolicyContext, objectId: string): Promise<boolean> {
  if (ctx.actor.role === "admin")
    return true;

  const row = await ctx.db
    .select({ id: driveEntries.id })
    .from(driveEntries)
    .where(and(
      eq(driveEntries.id, objectId),
      eq(driveEntries.ownerType, "user"),
      eq(driveEntries.ownerId, ctx.actor.id),
    ))
    .get();
  return row !== undefined;
}
