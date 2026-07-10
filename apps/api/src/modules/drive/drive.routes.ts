import type { Context } from "hono";
import type { DriveAccessActor } from "./drive.permission";
import type { DriveOwner } from "./drive.service";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { parseThumbnailWidth } from "@/modules/file";
import { policyContext } from "@/modules/policy";
import { hasCapability, isMember, resolveProjectId } from "@/modules/project/project.service";
import { AppError, ForbiddenError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { assertEntryCapability, driveAccess } from "./drive.permission";
import {
  buildDriveEntryDownloadResponse,
  confirmDriveUpload,
  createDriveFolder,
  createDriveSpreadsheet,
  createDriveTextFile,
  deleteDriveEntryPermanently,
  emptyDriveTrash,
  getDriveEntryById,
  getEntryOwner,
  listDriveEntries,
  listFavoriteDriveEntries,
  listRecentDriveEntries,
  listTrashedDriveEntries,
  presignDriveUpload,
  restoreDriveEntry,
  searchDriveEntries,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";
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
import { clearDisplayVersion, listEntryVersions, overwriteEntryVersion, setDisplayVersion, uploadEntryVersion } from "./drive.version.service";

const entryIdSchema = z.string().min(1);

const listSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  status: z.enum(["normal", "trash"]).optional(),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

const trashScopeSchema = z.object({
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

const searchEntriesSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

const createFolderSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
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
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

// Presigned direct upload (FEAT-044). The client computes the sha256 (lowercase
// hex) and declares the size/mimetype; the bytes go straight to S3.
const presignUploadSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  mimetype: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  parentEntryId: z.string().nullable().optional(),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

const confirmUploadSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mimetype: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  parentEntryId: z.string().nullable().optional(),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

const createSpreadsheetSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
  content: z.string(),
  ownerType: z.enum(["user", "team_directory", "project"]).optional(),
  ownerId: z.string().optional(),
});

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

const setDisplayVersionSchema = z.object({ versionId: z.string().min(1) });

// Path-param validators. Reuse `entryIdSchema` so the param contract matches
// the previous inline `entryIdSchema.parse(c.req.param(...))` checks.
const idParamSchema = z.object({ id: entryIdSchema });
const memberParamSchema = z.object({ id: entryIdSchema, memberId: entryIdSchema });
const versionParamSchema = z.object({ id: entryIdSchema, versionId: entryIdSchema });

// ── Response data schemas (mirror the service view shapes for the spec) ──
const ownerTypeSchema = z.enum(["user", "team_directory", "project"]);
const driveEntrySchema = z.object({
  id: z.string(),
  ownerType: ownerTypeSchema,
  ownerId: z.string(),
  parentEntryId: z.string().nullable(),
  type: z.enum(["folder", "file"]),
  name: z.string(),
  favorite: z.boolean(),
  status: z.enum(["normal", "trash"]),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  file: z.object({
    referenceId: z.string(),
    fileId: z.string(),
    filename: z.string(),
    mimetype: z.string(),
    size: z.number(),
  }).nullable(),
});

const driveVersionSchema = z.object({
  id: z.string(),
  versionNo: z.number(),
  filename: z.string(),
  mimetype: z.string(),
  size: z.number(),
  uploadedBy: z.string(),
  createdAt: z.string(),
  isCurrent: z.boolean(),
});

const teamDirectorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  role: directoryRoleSchema,
  memberCount: z.number(),
});

const teamMemberSchema = z.object({
  id: z.string(),
  directoryId: z.string(),
  userId: z.string(),
  role: directoryRoleSchema,
  createdAt: z.string(),
});

const idResultSchema = z.object({ id: z.string() });
const trashEmptiedSchema = z.object({ removed: z.number() });

function personalOwner(userId: string): DriveOwner {
  return { ownerType: "user", ownerId: userId };
}

function actorOf(c: Context<ProtectedEnv>): DriveAccessActor {
  const user = c.get("user");
  return { id: user.id, role: user.role };
}

/**
 * Translate an inbound project shortId (the sole external project identifier)
 * to the internal project ULID stored in `drive_entries.owner_id`. Fail-closed:
 * a missing / soft-deleted project surfaces as 404.
 */
async function resolveProjectOwnerId(c: Context<ProtectedEnv>, shortId: string): Promise<string> {
  const projectId = await resolveProjectId(c.get("db"), shortId);
  if (!projectId)
    throw new AppError("Project not found", 404, "NOT_FOUND");
  return projectId;
}

export function driveRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ── Listing / sidebar views (static paths registered before :id) ────────

  router.get(
    "/drive/entries",
    describeRoute({
      tags: ["drive"],
      summary: "List drive entries in a folder",
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("query", listSchema, onValidationFailure),
    async (c) => {
      const query = c.req.valid("query");
      const owner = await resolveListOwner(c, query.ownerType, query.ownerId);
      const data = await listDriveEntries(c.get("db"), {
        ...owner,
        parentEntryId: query.parentEntryId,
        status: query.status,
      });
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/drive/entries/recent",
    describeRoute({
      tags: ["drive"],
      summary: "List the caller's recently updated entries",
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user");
      const data = await listRecentDriveEntries(c.get("db"), user.id);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/drive/entries/favorites",
    describeRoute({
      tags: ["drive"],
      summary: "List the caller's favorite entries",
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user");
      const data = await listFavoriteDriveEntries(c.get("db"), user.id);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/drive/entries/search",
    describeRoute({
      tags: ["drive"],
      summary: "Search drive entries by name",
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("query", searchEntriesSchema, onValidationFailure),
    async (c) => {
      const query = c.req.valid("query");
      const owner = await resolveListOwner(c, query.ownerType, query.ownerId);
      const data = await searchDriveEntries(c.get("db"), owner, query.q, query.limit ?? 50);
      return c.json({ success: true, data });
    },
  );

  router.get(
    "/drive/entries/trash",
    describeRoute({
      tags: ["drive"],
      summary: "List a drive owner's trash-root entries",
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("query", trashScopeSchema, onValidationFailure),
    async (c) => {
      const query = c.req.valid("query");
      const owner = await resolveListOwner(c, query.ownerType, query.ownerId);
      const data = await listTrashedDriveEntries(c.get("db"), owner);
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/entries/trash",
    describeRoute({
      tags: ["drive"],
      summary: "Empty a drive owner's trash (personal by default)",
      responses: { 200: okJson(trashEmptiedSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("query", trashScopeSchema, onValidationFailure),
    async (c) => {
      const query = c.req.valid("query");
      // Write-level owner resolution: emptying a project/team trash purges
      // entries permanently, so it requires the same rights as creating there.
      const owner = await resolveCreateOwner(c, query.ownerType, query.ownerId);
      const removed = await emptyDriveTrash(c.get("db"), c.get("config"), owner);
      await auditFromCtx(c, {
        action: "drive.trash.emptied",
        resourceType: "drive_entry",
        resourceId: owner.ownerId,
        resourceName: "trash",
        detail: { removed },
        result: "success",
      });
      return c.json({ success: true, data: { removed } });
    },
  );

  router.post(
    "/drive/entries/text-file",
    describeRoute({
      tags: ["drive"],
      summary: "Create a text file entry",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", createTextFileSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const owner = await resolveCreateOwner(c, body.ownerType, body.ownerId);
      const entry = await createDriveTextFile(c.get("db"), c.get("config"), {
        ...owner,
        createdBy: user.id,
        parentEntryId: body.parentEntryId,
        name: body.name,
        content: body.content,
      });
      await auditFromCtx(c, {
        action: "drive.file.created",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry }, 201);
    },
  );

  router.post(
    "/drive/entries/spreadsheet",
    describeRoute({
      tags: ["drive"],
      summary: "Create a spreadsheet entry",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", createSpreadsheetSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const owner = await resolveCreateOwner(c, body.ownerType, body.ownerId);
      const entry = await createDriveSpreadsheet(c.get("db"), c.get("config"), {
        ...owner,
        createdBy: user.id,
        parentEntryId: body.parentEntryId,
        name: body.name,
        content: body.content,
      });
      await auditFromCtx(c, {
        action: "drive.file.created",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry }, 201);
    },
  );

  router.post(
    "/drive/folders",
    describeRoute({
      tags: ["drive"],
      summary: "Create a folder",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", createFolderSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const owner = await resolveCreateOwner(c, body.ownerType, body.ownerId);
      const entry = await createDriveFolder(c.get("db"), {
        ...owner,
        createdBy: user.id,
        parentEntryId: body.parentEntryId,
        name: body.name,
      });
      await auditFromCtx(c, {
        action: "drive.folder.created",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry }, 201);
    },
  );

  router.post(
    "/drive/files/upload",
    describeRoute({
      tags: ["drive"],
      summary: "Upload a file to the drive",
      requestBody: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" }, parentEntryId: { type: "string" }, ownerType: { type: "string" }, ownerId: { type: "string" } }, required: ["file"] } } },
      },
      responses: { 201: okJson(driveEntrySchema, "Created"), 400: { description: "No file provided", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user");
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");
      validateDriveUpload(file, c.get("config"));

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
      await auditFromCtx(c, {
        action: "drive.file.uploaded",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry }, 201);
    },
  );

  // Presigned direct upload (FEAT-044) — phase 1: authorize + dedup or presign.
  router.post(
    "/drive/files/presign-upload",
    describeRoute({
      tags: ["drive"],
      summary: "Begin a presigned direct upload (or finish instantly on dedup)",
      responses: { 200: okJson(z.object({ mode: z.literal("upload"), upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()) }) })), 201: okJson(z.object({ mode: z.literal("done"), entry: driveEntrySchema }), "Created (dedup)"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 409: { description: "Direct upload unavailable", ...errorJson }, 413: { description: "Too large", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", presignUploadSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const owner = await resolveCreateOwner(c, body.ownerType, body.ownerId);
      const result = await presignDriveUpload(c.get("db"), c.get("config"), {
        ...owner,
        createdBy: user.id,
        parentEntryId: body.parentEntryId ?? null,
        name: body.name,
        sha256: body.sha256,
        size: body.size,
        mimetype: body.mimetype,
      });
      if (result.mode === "done") {
        await auditFromCtx(c, {
          action: "drive.file.uploaded",
          resourceType: "drive_entry",
          resourceId: result.entry.id,
          resourceName: result.entry.name,
          result: "success",
        });
        return c.json({ success: true, data: { mode: "done", entry: result.entry } }, 201);
      }
      return c.json({ success: true, data: { mode: "upload", upload: result.upload } });
    },
  );

  // Presigned direct upload (FEAT-044) — phase 2: register the uploaded object.
  router.post(
    "/drive/files/confirm-upload",
    describeRoute({
      tags: ["drive"],
      summary: "Confirm a presigned direct upload and create the drive entry",
      responses: { 201: okJson(driveEntrySchema, "Created"), 400: { description: "Upload not found", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 413: { description: "Too large", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", confirmUploadSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const owner = await resolveCreateOwner(c, body.ownerType, body.ownerId);
      const entry = await confirmDriveUpload(c.get("db"), c.get("config"), {
        ...owner,
        createdBy: user.id,
        parentEntryId: body.parentEntryId ?? null,
        name: body.name,
        sha256: body.sha256,
        mimetype: body.mimetype,
      });
      await auditFromCtx(c, {
        action: "drive.file.uploaded",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry }, 201);
    },
  );

  // ── Single entry ────────────────────────────────────────────────────────

  router.get(
    "/drive/entries/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Get a drive entry",
      responses: { 200: okJson(driveEntrySchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      // No capability ⇒ hide existence (404); a visible-but-capability-denied
      // caller still gets 403 (assertEntryCapability). See decision 003.
      await assertEntryCapability(c.get("db"), actorOf(c), id, "read");
      const entry = await getDriveEntryById(c.get("db"), id);
      if (!entry)
        throw new AppError("Drive entry not found", 404, "NOT_FOUND");
      return c.json({ success: true, data: entry });
    },
  );

  router.get(
    "/drive/entries/:id/content",
    describeRoute({
      tags: ["drive"],
      summary: "Download a drive entry's file contents",
      responses: {
        200: { description: "File contents", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      // No capability ⇒ 404 (hide existence); visible-but-denied ⇒ 403. Decision 003.
      await assertEntryCapability(c.get("db"), actorOf(c), id, "download");
      const owner = await getEntryOwner(c.get("db"), id);
      return buildDriveEntryDownloadResponse(
        c.get("db"),
        c.get("config"),
        owner,
        id,
        c.req.query("inline") === "true",
        parseThumbnailWidth(c.req.query("thumb")),
      );
    },
  );

  // ── File versions ─────────────────────────────────────────────────────

  router.get(
    "/drive/entries/:id/versions",
    describeRoute({
      tags: ["drive"],
      summary: "List a file entry's versions",
      responses: { 200: okJson(z.array(driveVersionSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "read");
      const data = await listEntryVersions(c.get("db"), entry);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/drive/entries/:id/versions",
    describeRoute({
      tags: ["drive"],
      summary: "Upload a new version of a file entry",
      requestBody: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } },
      },
      responses: { 201: okJson(z.array(driveVersionSchema), "Created"), 400: { description: "No file provided", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");
      validateDriveUpload(file, c.get("config"));

      const data = await uploadEntryVersion(c.get("db"), c.get("config"), {
        entry,
        file,
        uploadedBy: user.id,
      });
      await auditFromCtx(c, {
        action: "drive.file.version_uploaded",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data }, 201);
    },
  );

  router.put(
    "/drive/entries/:id/versions/:versionId",
    describeRoute({
      tags: ["drive"],
      summary: "Overwrite a version's content in place (session-coalesced autosave)",
      requestBody: {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } },
      },
      responses: { 200: okJson(z.array(driveVersionSchema)), 400: { description: "No file provided", ...errorJson }, 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", versionParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id, versionId } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new AppError("Upload field 'file' is required", 400, "VALIDATION_ERROR");
      validateDriveUpload(file, c.get("config"));

      const data = await overwriteEntryVersion(c.get("db"), c.get("config"), {
        entry,
        versionId,
        file,
        uploadedBy: user.id,
      });
      await auditFromCtx(c, {
        action: "drive.file.version_overwritten",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        detail: { versionId },
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  // ── Display version (lock-free, version-only model) ─────────────────────
  // The entry's display pointer follows the latest version by default; these
  // routes pin it to a chosen version or clear the pin back to latest. Both
  // require the same "update" capability as a version upload.

  router.put(
    "/drive/entries/:id/display-version",
    describeRoute({
      tags: ["drive"],
      summary: "Pin the entry's display to a specific version",
      responses: { 200: okJson(z.array(driveVersionSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", setDisplayVersionSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const { versionId } = c.req.valid("json");
      const data = await setDisplayVersion(c.get("db"), entry, versionId);
      await auditFromCtx(c, {
        action: "drive.file.display_version_set",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        detail: { versionId },
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/entries/:id/display-version",
    describeRoute({
      tags: ["drive"],
      summary: "Clear the pinned display version (follow latest)",
      responses: { 200: okJson(z.array(driveVersionSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const data = await clearDisplayVersion(c.get("db"), entry);
      await auditFromCtx(c, {
        action: "drive.file.display_version_cleared",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  // Sharing now lives in the unified share module (`modules/share`): drive
  // shares are `shares` rows with `resource_type='drive_entry'`, managed via
  // `/shares/drive_entry/:id` and served via `/shared/:token`.

  router.patch(
    "/drive/entries/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Update a drive entry (rename / move / favorite)",
      responses: { 200: okJson(driveEntrySchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateEntrySchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await driveAccess.assert(policyContext(c)!, "drive:update", id);
      const body = c.req.valid("json");
      const owner = await getEntryOwner(c.get("db"), id);
      const entry = await updateDriveEntry(c.get("db"), { ...owner, id, ...body });
      await auditFromCtx(c, {
        action: "drive.entry.updated",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry });
    },
  );

  router.post(
    "/drive/entries/:id/restore",
    describeRoute({
      tags: ["drive"],
      summary: "Restore a trashed drive entry",
      responses: { 200: okJson(driveEntrySchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await driveAccess.assert(policyContext(c)!, "drive:update", id);
      const owner = await getEntryOwner(c.get("db"), id);
      const entry = await restoreDriveEntry(c.get("db"), owner, id);
      await auditFromCtx(c, {
        action: "drive.entry.restored",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        result: "success",
      });
      return c.json({ success: true, data: entry });
    },
  );

  router.delete(
    "/drive/entries/:id/permanent",
    describeRoute({
      tags: ["drive"],
      summary: "Permanently delete a drive entry",
      responses: { 200: okJson(idResultSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await driveAccess.assert(policyContext(c)!, "drive:delete", id);
      const owner = await getEntryOwner(c.get("db"), id);
      await deleteDriveEntryPermanently(c.get("db"), c.get("config"), owner, id);
      await auditFromCtx(c, {
        action: "drive.entry.deleted",
        resourceType: "drive_entry",
        resourceId: id,
        resourceName: id,
        result: "success",
      });
      return c.json({ success: true, data: { id } });
    },
  );

  router.delete(
    "/drive/entries/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Move a drive entry to trash",
      responses: { 200: okJson(idResultSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await driveAccess.assert(policyContext(c)!, "drive:delete", id);
      const owner = await getEntryOwner(c.get("db"), id);
      await trashDriveEntry(c.get("db"), owner, id);
      await auditFromCtx(c, {
        action: "drive.entry.trashed",
        resourceType: "drive_entry",
        resourceId: id,
        resourceName: id,
        result: "success",
      });
      return c.json({ success: true, data: { id } });
    },
  );

  // ── Team directories ──────────────────────────────────────────────────

  router.get(
    "/drive/team-directories",
    describeRoute({
      tags: ["drive"],
      summary: "List the caller's team directories",
      responses: { 200: okJson(z.array(teamDirectorySchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    async (c) => {
      const user = c.get("user");
      const data = await listTeamDirectories(c.get("db"), user.id);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/drive/team-directories",
    describeRoute({
      tags: ["drive"],
      summary: "Create a team directory",
      responses: { 201: okJson(teamDirectorySchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("json", createDirectorySchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const data = await createTeamDirectory(c.get("db"), {
        name: body.name,
        description: body.description,
        createdBy: user.id,
      });
      await auditFromCtx(c, {
        action: "drive.directory.created",
        resourceType: "team_directory",
        resourceId: data.id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data }, 201);
    },
  );

  router.get(
    "/drive/team-directories/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Get a team directory",
      responses: { 200: okJson(teamDirectorySchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const data = await getTeamDirectory(c.get("db"), directoryId, user.id);
      return c.json({ success: true, data });
    },
  );

  router.put(
    "/drive/team-directories/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Update a team directory",
      responses: { 200: okJson(teamDirectorySchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateDirectorySchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const body = c.req.valid("json");
      const data = await updateTeamDirectory(c.get("db"), directoryId, user.id, body);
      await auditFromCtx(c, {
        action: "drive.directory.updated",
        resourceType: "team_directory",
        resourceId: data.id,
        resourceName: data.name,
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/team-directories/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Delete a team directory",
      responses: { 200: okJson(idResultSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      await deleteTeamDirectory(c.get("db"), directoryId, user.id);
      await auditFromCtx(c, {
        action: "drive.directory.deleted",
        resourceType: "team_directory",
        resourceId: directoryId,
        resourceName: directoryId,
        result: "success",
      });
      return c.json({ success: true, data: { id: directoryId } });
    },
  );

  router.get(
    "/drive/team-directories/:id/members",
    describeRoute({
      tags: ["drive"],
      summary: "List a team directory's members",
      responses: { 200: okJson(z.array(teamMemberSchema)), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const data = await listTeamMembers(c.get("db"), directoryId, user.id);
      return c.json({ success: true, data });
    },
  );

  router.post(
    "/drive/team-directories/:id/members",
    describeRoute({
      tags: ["drive"],
      summary: "Add a member to a team directory",
      responses: { 201: okJson(teamMemberSchema, "Created"), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", addMemberSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const body = c.req.valid("json");
      const data = await addTeamMember(c.get("db"), directoryId, user.id, body);
      await auditFromCtx(c, {
        action: "drive.directory.member_added",
        resourceType: "team_directory",
        resourceId: directoryId,
        resourceName: directoryId,
        detail: { memberId: data.userId, role: data.role },
        result: "success",
      });
      return c.json({ success: true, data }, 201);
    },
  );

  router.put(
    "/drive/team-directories/:id/members/:memberId",
    describeRoute({
      tags: ["drive"],
      summary: "Update a team directory member's role",
      responses: { 200: okJson(teamMemberSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", memberParamSchema, onValidationFailure),
    validator("json", updateMemberSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId, memberId } = c.req.valid("param");
      const body = c.req.valid("json");
      const data = await updateTeamMember(c.get("db"), directoryId, memberId, user.id, body.role);
      await auditFromCtx(c, {
        action: "drive.directory.member_updated",
        resourceType: "team_directory",
        resourceId: directoryId,
        resourceName: directoryId,
        detail: { memberId, role: data.role },
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/team-directories/:id/members/:memberId",
    describeRoute({
      tags: ["drive"],
      summary: "Remove a member from a team directory",
      responses: { 200: okJson(idResultSchema), 401: { description: "Unauthenticated", ...errorJson }, 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", memberParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId, memberId } = c.req.valid("param");
      await removeTeamMember(c.get("db"), directoryId, memberId, user.id);
      await auditFromCtx(c, {
        action: "drive.directory.member_removed",
        resourceType: "team_directory",
        resourceId: directoryId,
        resourceName: directoryId,
        detail: { memberId },
        result: "success",
      });
      return c.json({ success: true, data: { id: memberId } });
    },
  );

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
  c: Context<ProtectedEnv>,
  ownerType: "user" | "team_directory" | "project" | undefined,
  ownerId: string | undefined,
): Promise<DriveOwner> {
  const user = c.get("user");

  if (ownerType === undefined || ownerType === "user") {
    if (ownerId && ownerId !== user.id)
      throw new ForbiddenError("Cannot list another user's drive");
    return personalOwner(user.id);
  }

  if (ownerType === "project") {
    if (!ownerId)
      throw new AppError("ownerId is required for project listing", 400, "VALIDATION_ERROR");
    const projectId = await resolveProjectOwnerId(c, ownerId);
    // App admins bypass project membership (consistent with project routes).
    if (user.role !== "admin") {
      if (!(await isMember(c.get("db"), projectId, user.id)))
        throw new ForbiddenError("You do not have access to this project");
      if (!(await hasCapability(c.get("db"), projectId, user.id, "files.view")))
        throw new ForbiddenError("files.view capability required to list project files");
    }
    return { ownerType: "project", ownerId: projectId };
  }

  if (!ownerId)
    throw new AppError("ownerId is required for team_directory listing", 400, "VALIDATION_ERROR");
  const role = await getDirectoryRole(c.get("db"), ownerId, user.id);
  if (role === null)
    throw new ForbiddenError("You do not have access to this team directory");
  return { ownerType: "team_directory", ownerId };
}

/**
 * Resolve the owner for a JSON create request (folder / text-file). Mirrors
 * `resolveUploadOwner`: personal by default, and a `team_directory` target
 * requires editor-or-admin — viewers are read-only and cannot create. The
 * `user` path rejects a foreign `ownerId` so creation stays caller-scoped.
 */
async function resolveCreateOwner(
  c: Context<ProtectedEnv>,
  ownerType: "user" | "team_directory" | "project" | undefined,
  ownerId: string | undefined,
): Promise<DriveOwner> {
  const user = c.get("user");

  if (ownerType === undefined || ownerType === "user") {
    if (ownerId && ownerId !== user.id)
      throw new ForbiddenError("Cannot create in another user's drive");
    return personalOwner(user.id);
  }

  if (ownerType === "project") {
    if (!ownerId)
      throw new AppError("ownerId is required for project creation", 400, "VALIDATION_ERROR");
    // files.manage capability required; app admins bypass.
    const projectId = await resolveProjectOwnerId(c, ownerId);
    if (user.role !== "admin") {
      if (!(await isMember(c.get("db"), projectId, user.id)))
        throw new ForbiddenError("Project membership required to create in this project");
      if (!(await hasCapability(c.get("db"), projectId, user.id, "files.manage")))
        throw new ForbiddenError("files.manage capability required to create project files");
    }
    return { ownerType: "project", ownerId: projectId };
  }

  if (!ownerId)
    throw new AppError("ownerId is required for team_directory creation", 400, "VALIDATION_ERROR");
  const role = await getDirectoryRole(c.get("db"), ownerId, user.id);
  if (role !== "admin" && role !== "editor")
    throw new ForbiddenError("Editor access required to create in this team directory");
  return { ownerType: "team_directory", ownerId };
}

/**
 * Resolve the upload target owner from the multipart form. Defaults to the
 * caller's personal drive. A `team_directory` target requires the caller to
 * be an editor or admin of that directory.
 */
async function resolveUploadOwner(c: Context<ProtectedEnv>, form: FormData): Promise<DriveOwner> {
  const user = c.get("user");
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

  if (ownerTypeRaw === "project") {
    if (typeof ownerIdRaw !== "string" || !ownerIdRaw)
      throw new AppError("ownerId is required for project uploads", 400, "VALIDATION_ERROR");
    // files.manage capability required; app admins bypass.
    const projectId = await resolveProjectOwnerId(c, ownerIdRaw);
    if (user.role !== "admin") {
      if (!(await isMember(c.get("db"), projectId, user.id)))
        throw new ForbiddenError("Project membership required to upload to this project");
      if (!(await hasCapability(c.get("db"), projectId, user.id, "files.manage")))
        throw new ForbiddenError("files.manage capability required to upload to this project");
    }
    return { ownerType: "project", ownerId: projectId };
  }

  throw new AppError("Invalid ownerType", 400, "VALIDATION_ERROR");
}
