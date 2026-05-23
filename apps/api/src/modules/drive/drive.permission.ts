import type { DriveEntryRow } from "./drive.service";
import type { DriveOwnerType } from "./schema";
import type { AppDatabase } from "@/db";
import type { PolicyContext } from "@/modules/policy";
import { and, eq } from "drizzle-orm";
import { defineResource } from "@/modules/policy";
import { getRole as getProjectRole } from "@/modules/project/project.service";
import { shares } from "@/modules/share/schema";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { getDirectoryRole } from "./drive.team-directory.service";
import { driveEntries } from "./schema";

type DriveAction
  = | "drive:read"
    | "drive:update"
    | "drive:delete"
    | "drive:download";

/**
 * Effective capability an actor holds on a single drive entry. These are
 * resolved by {@link resolveEntryCapabilities} from three independent
 * sources (global admin, ownership / team role, direct share grant) and
 * unioned together.
 */
export type DriveCapability = "read" | "download" | "update" | "delete" | "share";

const ALL_CAPABILITIES: readonly DriveCapability[] = ["read", "download", "update", "delete", "share"];

const ACTION_CAPABILITY: Record<DriveAction, DriveCapability> = {
  "drive:read": "read",
  "drive:update": "update",
  "drive:delete": "delete",
  "drive:download": "download",
};

export interface DriveAccessActor {
  readonly id: string;
  readonly role: string;
}

interface EntryOwnerInfo {
  readonly id: string;
  readonly ownerType: DriveOwnerType;
  readonly ownerId: string;
}

/**
 * Resolve every capability `actor` has on `entry`.
 *
 * - Global `admin` actors and the personal owner get the full set.
 * - Team-directory `admin` / `editor` get full management (create / update /
 *   delete / share); `viewer` gets read + download only.
 * - Project `pm` (admin-equivalent) and internal `member` (editor-equivalent)
 *   get full management; non-members get nothing (fail-closed). The project
 *   file root is protected at the route layer, not here.
 * - An active direct share to the actor is **additive**: any grant confers
 *   read + download (a recipient can always view and download what was shared
 *   with them); `edit` additionally confers update. Direct shares never confer
 *   `share` or `delete`.
 */
export async function resolveEntryCapabilities(
  db: AppDatabase,
  entry: EntryOwnerInfo,
  actor: DriveAccessActor,
): Promise<Set<DriveCapability>> {
  if (actor.role === "admin")
    return new Set(ALL_CAPABILITIES);

  const caps = new Set<DriveCapability>();

  if (entry.ownerType === "user") {
    if (entry.ownerId === actor.id)
      addAll(caps);
  }
  else if (entry.ownerType === "team_directory") {
    const role = await getDirectoryRole(db, entry.ownerId, actor.id);
    if (role === "admin" || role === "editor") {
      addAll(caps);
    }
    else if (role === "viewer") {
      caps.add("read");
      caps.add("download");
    }
  }
  else if (entry.ownerType === "project") {
    const role = await getProjectRole(db, entry.ownerId, actor.id);
    // pm ≈ team admin, member ≈ team editor: both get full management.
    if (role === "pm" || role === "member")
      addAll(caps);
  }

  const share = await db
    .select({ permission: shares.permission })
    .from(shares)
    .where(and(
      eq(shares.resourceType, "drive_entry"),
      eq(shares.resourceId, entry.id),
      eq(shares.shareType, "direct"),
      eq(shares.sharedWithUserId, actor.id),
      eq(shares.isActive, 1),
    ))
    .get();
  if (share) {
    caps.add("read");
    caps.add("download");
    if (share.permission === "edit")
      caps.add("update");
  }

  return caps;
}

/**
 * Fetch an entry by id (owner-agnostic) and assert the actor holds
 * `capability`. Returns the row so callers can use its real owner. Throws
 * `NotFoundError` for missing entries and `ForbiddenError` when the
 * capability is absent.
 */
export async function assertEntryCapability(
  db: AppDatabase,
  actor: DriveAccessActor,
  entryId: string,
  capability: DriveCapability,
): Promise<DriveEntryRow> {
  const entry = await db.select().from(driveEntries).where(eq(driveEntries.id, entryId)).get();
  if (!entry)
    throw new NotFoundError("Drive entry", entryId);
  const caps = await resolveEntryCapabilities(db, entry, actor);
  if (!caps.has(capability))
    throw new ForbiddenError();
  return entry;
}

export const driveAccess = defineResource<DriveAction>({
  name: "drive",
  namespace: "drive_entry",
  description: "Drive entries (personal, team-directory and shared)",
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
    // Capability bypass: owners, team-directory members and direct-share
    // recipients are authorised here. The Zanzibar engine has no drive
    // tuples, so a `false` return correctly denies everyone else.
    bypass: async (ctx, action, objectId) => hasCapabilityFor(ctx, action, objectId),
    // Return null for ids that are not real entries so the global
    // `policyMiddleware` falls through to the handler. Without this, the
    // `/drive/entries/:id` binding would capture sibling static paths
    // (`/drive/entries/recent`, `/drive/entries/favorites`,
    // `/drive/entries/trash`) and reject them for non-admins.
    resolveObjectId: async (c, params) => {
      const id = params.id;
      if (!id)
        return null;
      const row = await c.get("db")
        .select({ id: driveEntries.id })
        .from(driveEntries)
        .where(eq(driveEntries.id, id))
        .get();
      return row?.id ?? null;
    },
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

async function hasCapabilityFor(ctx: PolicyContext, action: string, objectId: string): Promise<boolean> {
  const capability = ACTION_CAPABILITY[action as DriveAction];
  if (!capability)
    return false;

  const entry = await ctx.db
    .select({ id: driveEntries.id, ownerType: driveEntries.ownerType, ownerId: driveEntries.ownerId })
    .from(driveEntries)
    .where(eq(driveEntries.id, objectId))
    .get();
  if (!entry)
    return false;

  const caps = await resolveEntryCapabilities(ctx.db, entry, { id: ctx.actor.id, role: ctx.actor.role ?? "user" });
  return caps.has(capability);
}

function addAll(caps: Set<DriveCapability>): void {
  for (const c of ALL_CAPABILITIES)
    caps.add(c);
}
