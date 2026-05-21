import type { Context } from "hono";
import type { DriveAccessActor } from "./drive.permission";
import type { DriveOwner } from "./drive.service";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { policyContext } from "@/modules/policy";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError } from "@/shared/lib/errors";
import { authRequired } from "@/shared/middleware/auth";
import { assertEntryCapability, driveAccess } from "./drive.permission";
import {
  buildDriveEntryDownloadResponse,
  createDriveFolder,
  createDriveTextFile,
  deleteDriveEntryPermanently,
  emptyDriveTrash,
  getDriveEntryById,
  getEntryOwner,
  listDriveEntries,
  listFavoriteDriveEntries,
  listRecentDriveEntries,
  restoreDriveEntry,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";
import {
  createShare,
  listLinkShares,
  listReceivedShares,
  listSentShares,
  listSharesForEntry,
  revokeShare,
  updateShare,
} from "./drive.share.service";
import {
  addTeamMember,
  createTeamDirectory,
  deleteTeamDirectory,
  getDirectoryRole,
  getTeamDirectory,
  listTeamDirectories,
  listTeamMembers,
  removeTeamMember,
  updateTeamDirectory,
  updateTeamMember,
} from "./drive.team-directory.service";
import { validateDriveUpload } from "./drive.upload-validation";
import { listEntryVersions, switchEntryVersion, uploadEntryVersion } from "./drive.version.service";

const entryIdSchema = z.string().min(1);

const listSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  status: z.enum(["normal", "trash"]).optional(),
  ownerType: z.enum(["user", "team_directory"]).optional(),
  ownerId: z.string().optional(),
});

const createFolderSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
});

const updateEntrySchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255).optional(),
  favorite: z.boolean().optional(),
}).refine(v => v.parentEntryId !== undefined || v.name !== undefined || v.favorite !== undefined, {
  message: "At least one field must be provided",
});

const createTextFileSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
});

const sharePermissionSchema = z.enum(["view", "download", "edit"]);

const createShareSchema = z.discriminatedUnion("shareType", [
  z.object({
    shareType: z.literal("direct"),
    sharedWithUserId: z.string().min(1),
    permission: sharePermissionSchema,
  }),
  z.object({
    shareType: z.literal("public_link"),
    permission: sharePermissionSchema.default("view"),
    password: z.string().min(1).optional(),
    expiresAt: z.string().min(1).optional(),
    maxDownloads: z.number().int().positive().optional(),
  }),
]);

const updateShareSchema = z.object({
  permission: sharePermissionSchema.optional(),
  password: z.string().min(1).nullable().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
  maxDownloads: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
}).refine(
  v => v.permission !== undefined || v.password !== undefined || v.expiresAt !== undefined || v.maxDownloads !== undefined || v.isActive !== undefined,
  { message: "At least one field must be provided" },
);

const directoryRoleSchema = z.enum(["admin", "editor", "viewer"]);

const createDirectorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
});

const updateDirectorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => v.name !== undefined || v.description !== undefined, {
  message: "At least one field must be provided",
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: directoryRoleSchema.optional(),
});

const updateMemberSchema = z.object({ role: directoryRoleSchema });

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

function personalOwner(userId: string): DriveOwner {
  return { ownerType: "user", ownerId: userId };
}

function actorOf(c: Context<AppEnv>): DriveAccessActor {
  const user = c.get("user")!;
  return { id: user.id, role: user.role };
}

export function driveRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // ── Listing / sidebar views (static paths registered before :id) ────────

  router.get("/drive/entries", async (c) => {
    const query = listSchema.parse({
      parentEntryId: c.req.query("parentEntryId") ?? null,
      status: c.req.query("status") ?? undefined,
      ownerType: c.req.query("ownerType") ?? undefined,
      ownerId: c.req.query("ownerId") ?? undefined,
    });
    const owner = await resolveListOwner(c, query.ownerType, query.ownerId);
    const data = await listDriveEntries(c.get("db"), {
      ...owner,
      parentEntryId: query.parentEntryId,
      status: query.status,
    });
    return c.json({ success: true, data });
  });

  router.get("/drive/entries/recent", async (c) => {
    const user = c.get("user")!;
    const data = await listRecentDriveEntries(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.get("/drive/entries/favorites", async (c) => {
    const user = c.get("user")!;
    const data = await listFavoriteDriveEntries(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.delete("/drive/entries/trash", async (c) => {
    const user = c.get("user")!;
    const removed = await emptyDriveTrash(c.get("db"), c.get("config"), personalOwner(user.id));
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.trash.emptied",
      resourceType: "drive_entry",
      resourceId: user.id,
      resourceName: "trash",
      detail: { removed },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { removed } });
  });

  router.post("/drive/entries/text-file", async (c) => {
    const user = c.get("user")!;
    const body = createTextFileSchema.parse(await c.req.json());
    const entry = await createDriveTextFile(c.get("db"), c.get("config"), {
      ...personalOwner(user.id),
      createdBy: user.id,
      parentEntryId: body.parentEntryId,
      name: body.name,
      content: body.content,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.file.created",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry }, 201);
  });

  router.post("/drive/folders", async (c) => {
    const user = c.get("user")!;
    const body = createFolderSchema.parse(await c.req.json());
    const entry = await createDriveFolder(c.get("db"), {
      ...personalOwner(user.id),
      createdBy: user.id,
      parentEntryId: body.parentEntryId,
      name: body.name,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.folder.created",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry }, 201);
  });

  router.post("/drive/files/upload", async (c) => {
    const user = c.get("user")!;
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");
    await validateDriveUpload(file, c.get("config"));

    const parentEntryId = form.get("parentEntryId");
    if (parentEntryId !== null && typeof parentEntryId !== "string")
      throw new AppError("parentEntryId must be a string", 400, "VALIDATION_ERROR");

    const owner = await resolveUploadOwner(c, form);
    const entry = await uploadDriveFile(c.get("db"), c.get("config"), {
      ...owner,
      createdBy: user.id,
      parentEntryId,
      file,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.file.uploaded",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry }, 201);
  });

  // ── Single entry ────────────────────────────────────────────────────────

  router.get("/drive/entries/:id", async (c) => {
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:read", id);
    const entry = await getDriveEntryById(c.get("db"), id);
    if (!entry)
      throw new AppError("Drive entry not found", 404, "NOT_FOUND");
    return c.json({ success: true, data: entry });
  });

  router.get("/drive/entries/:id/content", async (c) => {
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:download", id);
    const owner = await getEntryOwner(c.get("db"), id);
    return buildDriveEntryDownloadResponse(
      c.get("db"),
      c.get("config"),
      owner,
      id,
      c.req.query("inline") === "true",
    );
  });

  // ── File versions ─────────────────────────────────────────────────────

  router.get("/drive/entries/:id/versions", async (c) => {
    const id = entryIdSchema.parse(c.req.param("id"));
    const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "read");
    const data = await listEntryVersions(c.get("db"), entry);
    return c.json({ success: true, data });
  });

  router.post("/drive/entries/:id/versions", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");
    await validateDriveUpload(file, c.get("config"));

    const data = await uploadEntryVersion(c.get("db"), c.get("config"), {
      entry,
      file,
      uploadedBy: user.id,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.file.version_uploaded",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  router.post("/drive/entries/:id/versions/:versionId/current", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    const versionId = entryIdSchema.parse(c.req.param("versionId"));
    const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
    const data = await switchEntryVersion(c.get("db"), entry, versionId);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.file.version_switched",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      detail: { versionId },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  // ── Entry-scoped shares ──────────────────────────────────────────────

  router.get("/drive/entries/:id/shares", async (c) => {
    const id = entryIdSchema.parse(c.req.param("id"));
    await assertEntryCapability(c.get("db"), actorOf(c), id, "share");
    const data = await listSharesForEntry(c.get("db"), id);
    return c.json({ success: true, data });
  });

  router.post("/drive/entries/:id/shares", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "share");
    const body = createShareSchema.parse(await c.req.json());
    const data = await createShare(c.get("db"), {
      entry,
      createdBy: user.id,
      shareType: body.shareType,
      permission: body.permission,
      sharedWithUserId: body.shareType === "direct" ? body.sharedWithUserId : undefined,
      password: body.shareType === "public_link" ? body.password : undefined,
      expiresAt: body.shareType === "public_link" ? body.expiresAt : undefined,
      maxDownloads: body.shareType === "public_link" ? body.maxDownloads : undefined,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.share.created",
      resourceType: "drive_share",
      resourceId: data.id,
      resourceName: entry.name,
      detail: { shareType: data.shareType, permission: data.permission },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  router.patch("/drive/entries/:id", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:update", id);
    const body = updateEntrySchema.parse(await c.req.json());
    const owner = await getEntryOwner(c.get("db"), id);
    const entry = await updateDriveEntry(c.get("db"), { ...owner, id, ...body });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.updated",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry });
  });

  router.post("/drive/entries/:id/restore", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:update", id);
    const owner = await getEntryOwner(c.get("db"), id);
    const entry = await restoreDriveEntry(c.get("db"), owner, id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.restored",
      resourceType: "drive_entry",
      resourceId: entry.id,
      resourceName: entry.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: entry });
  });

  router.delete("/drive/entries/:id/permanent", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:delete", id);
    const owner = await getEntryOwner(c.get("db"), id);
    await deleteDriveEntryPermanently(c.get("db"), c.get("config"), owner, id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.deleted",
      resourceType: "drive_entry",
      resourceId: id,
      resourceName: id,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id } });
  });

  router.delete("/drive/entries/:id", async (c) => {
    const user = c.get("user")!;
    const id = entryIdSchema.parse(c.req.param("id"));
    await driveAccess.assert(policyContext(c)!, "drive:delete", id);
    const owner = await getEntryOwner(c.get("db"), id);
    await trashDriveEntry(c.get("db"), owner, id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.entry.trashed",
      resourceType: "drive_entry",
      resourceId: id,
      resourceName: id,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id } });
  });

  // ── Share inboxes / outboxes (static paths before :id) ─────────────────

  router.get("/drive/shares/received", async (c) => {
    const user = c.get("user")!;
    const data = await listReceivedShares(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.get("/drive/shares/sent", async (c) => {
    const user = c.get("user")!;
    const data = await listSentShares(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.get("/drive/shares/links", async (c) => {
    const user = c.get("user")!;
    const data = await listLinkShares(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.put("/drive/shares/:id", async (c) => {
    const user = c.get("user")!;
    const shareId = entryIdSchema.parse(c.req.param("id"));
    const body = updateShareSchema.parse(await c.req.json());
    const data = await updateShare(c.get("db"), shareId, user.id, body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.share.updated",
      resourceType: "drive_share",
      resourceId: data.id,
      resourceName: data.entryName,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.delete("/drive/shares/:id", async (c) => {
    const user = c.get("user")!;
    const shareId = entryIdSchema.parse(c.req.param("id"));
    await revokeShare(c.get("db"), shareId, user.id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.share.revoked",
      resourceType: "drive_share",
      resourceId: shareId,
      resourceName: shareId,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id: shareId } });
  });

  // ── Team directories ──────────────────────────────────────────────────

  router.get("/drive/team-directories", async (c) => {
    const user = c.get("user")!;
    const data = await listTeamDirectories(c.get("db"), user.id);
    return c.json({ success: true, data });
  });

  router.post("/drive/team-directories", async (c) => {
    const user = c.get("user")!;
    const body = createDirectorySchema.parse(await c.req.json());
    const data = await createTeamDirectory(c.get("db"), {
      name: body.name,
      description: body.description,
      createdBy: user.id,
    });
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.created",
      resourceType: "team_directory",
      resourceId: data.id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  router.get("/drive/team-directories/:id", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const data = await getTeamDirectory(c.get("db"), directoryId, user.id);
    return c.json({ success: true, data });
  });

  router.put("/drive/team-directories/:id", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const body = updateDirectorySchema.parse(await c.req.json());
    const data = await updateTeamDirectory(c.get("db"), directoryId, user.id, body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.updated",
      resourceType: "team_directory",
      resourceId: data.id,
      resourceName: data.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.delete("/drive/team-directories/:id", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    await deleteTeamDirectory(c.get("db"), directoryId, user.id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.deleted",
      resourceType: "team_directory",
      resourceId: directoryId,
      resourceName: directoryId,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id: directoryId } });
  });

  router.get("/drive/team-directories/:id/members", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const data = await listTeamMembers(c.get("db"), directoryId, user.id);
    return c.json({ success: true, data });
  });

  router.post("/drive/team-directories/:id/members", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const body = addMemberSchema.parse(await c.req.json());
    const data = await addTeamMember(c.get("db"), directoryId, user.id, body);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.member_added",
      resourceType: "team_directory",
      resourceId: directoryId,
      resourceName: directoryId,
      detail: { memberId: data.userId, role: data.role },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data }, 201);
  });

  router.put("/drive/team-directories/:id/members/:memberId", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const memberId = entryIdSchema.parse(c.req.param("memberId"));
    const body = updateMemberSchema.parse(await c.req.json());
    const data = await updateTeamMember(c.get("db"), directoryId, memberId, user.id, body.role);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.member_updated",
      resourceType: "team_directory",
      resourceId: directoryId,
      resourceName: directoryId,
      detail: { memberId, role: data.role },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data });
  });

  router.delete("/drive/team-directories/:id/members/:memberId", async (c) => {
    const user = c.get("user")!;
    const directoryId = entryIdSchema.parse(c.req.param("id"));
    const memberId = entryIdSchema.parse(c.req.param("memberId"));
    await removeTeamMember(c.get("db"), directoryId, memberId, user.id);
    await audit(c.get("db"), c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "drive.directory.member_removed",
      resourceType: "team_directory",
      resourceId: directoryId,
      resourceName: directoryId,
      detail: { memberId },
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: { id: memberId } });
  });

  return router;
}

/**
 * Resolve the listing scope from query params. Defaults to the caller's
 * personal drive. A `team_directory` scope requires the caller to be a
 * member of that directory (any role — viewers can browse). Mirrors the
 * `user`-path guard used by the upload handler so a different `ownerId`
 * cannot read another user's drive.
 */
async function resolveListOwner(
  c: Context<AppEnv>,
  ownerType: "user" | "team_directory" | undefined,
  ownerId: string | undefined,
): Promise<DriveOwner> {
  const user = c.get("user")!;

  if (ownerType === undefined || ownerType === "user") {
    if (ownerId && ownerId !== user.id)
      throw new ForbiddenError("Cannot list another user's drive");
    return personalOwner(user.id);
  }

  if (!ownerId)
    throw new AppError("ownerId is required for team_directory listing", 400, "VALIDATION_ERROR");
  const role = await getDirectoryRole(c.get("db"), ownerId, user.id);
  if (role === null)
    throw new ForbiddenError("You do not have access to this team directory");
  return { ownerType: "team_directory", ownerId };
}

/**
 * Resolve the upload target owner from the multipart form. Defaults to the
 * caller's personal drive. A `team_directory` target requires the caller to
 * be an editor or admin of that directory.
 */
async function resolveUploadOwner(c: Context<AppEnv>, form: FormData): Promise<DriveOwner> {
  const user = c.get("user")!;
  const ownerTypeRaw = form.get("ownerType");
  const ownerIdRaw = form.get("ownerId");

  if (ownerTypeRaw === null || ownerTypeRaw === "user") {
    if (typeof ownerIdRaw === "string" && ownerIdRaw && ownerIdRaw !== user.id)
      throw new ForbiddenError("Cannot upload to another user's drive");
    return personalOwner(user.id);
  }

  if (ownerTypeRaw === "team_directory") {
    if (typeof ownerIdRaw !== "string" || !ownerIdRaw)
      throw new AppError("ownerId is required for team_directory uploads", 400, "VALIDATION_ERROR");
    const role = await getDirectoryRole(c.get("db"), ownerIdRaw, user.id);
    if (role !== "admin" && role !== "editor")
      throw new ForbiddenError("Editor access required to upload to this team directory");
    return { ownerType: "team_directory", ownerId: ownerIdRaw };
  }

  throw new AppError("Invalid ownerType", 400, "VALIDATION_ERROR");
}
