import type { Context } from "hono";
import type { DriveAccessActor } from "./drive.permission";
import type { DriveOwner } from "./drive.service";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { parseThumbnailWidth } from "@/modules/file";
import { policyContext } from "@/modules/policy";
import { hasCapability, isMember, resolveProjectId } from "@/modules/project/project.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import {
  acquireEditLock,
  EditLockConflictError,
  heartbeatEditLock,
  releaseEditLock,
  updateEntryLiveContent,
} from "./drive.edit-lock.service";
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
import { listEntryVersions, switchEntryVersion, uploadEntryVersion } from "./drive.version.service";

const entryIdSchema = z.string().min(1);

const listSchema = z.object({
  parentEntryId: z.string().nullable().optional(),
  status: z.enum(["normal", "trash"]).optional(),
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

const editLockSchema = z.object({ editId: z.string().min(1) });
const liveContentSchema = z.object({ editId: z.string().min(1), content: z.string() });

// Path-param validators. Reuse `entryIdSchema` so the param contract matches
// the previous inline `entryIdSchema.parse(c.req.param(...))` checks.
const idParamSchema = z.object({ id: entryIdSchema });
const versionParamSchema = z.object({ id: entryIdSchema, versionId: entryIdSchema });
const memberParamSchema = z.object({ id: entryIdSchema, memberId: entryIdSchema });

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

const acquireEditLockResultSchema = z.object({
  editId: z.string(),
  lockBy: z.string(),
  lockAt: z.number(),
  takenOver: z.boolean(),
});
const heartbeatEditLockResultSchema = z.object({ editId: z.string(), lockAt: z.number() });
const releaseEditLockResultSchema = z.object({ released: z.boolean() });
const liveContentResultSchema = z.object({ id: z.string(), updatedAt: z.string() });
const idResultSchema = z.object({ id: z.string() });
const trashEmptiedSchema = z.object({ removed: z.number() });

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
// `{ success:false, error }` response doc for an error status.
function errJson(description: string) {
  return { description, content: { "application/json": { schema: resolver(ErrorEnvelope) } } };
}

function auditMeta(c: Context) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

function personalOwner(userId: string): DriveOwner {
  return { ownerType: "user", ownerId: userId };
}

function actorOf(c: Context<ProtectedEnv>): DriveAccessActor {
  const user = c.get("user");
  return { id: user.id, role: user.role };
}

/**
 * Resolve the `editId` for a lock release. The unload-path release arrives via
 * `fetch(..., { keepalive: true })` — normally a JSON body, but parse leniently:
 * read the raw text ONCE (calling `c.req.json()` first would poison Hono's body
 * cache on a parse error), accept a JSON `{ editId }`, and fall back to the
 * `?editId=` query so a degraded unload still releases the lock.
 */
async function readEditId(c: Context<ProtectedEnv>): Promise<string> {
  const raw = await c.req.text().catch(() => "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { editId?: unknown };
      if (typeof parsed.editId === "string" && parsed.editId.length > 0)
        return parsed.editId;
    }
    catch {
      // Not JSON — fall through to the query-string fallback.
    }
  }
  const fromQuery = c.req.query("editId");
  if (fromQuery)
    return fromQuery;
  throw new AppError("editId is required", 400, "VALIDATION_ERROR");
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
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 422: errJson("Validation error") },
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
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: errJson("Unauthenticated") },
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
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: errJson("Unauthenticated") },
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
      responses: { 200: okJson(z.array(driveEntrySchema)), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 422: errJson("Validation error") },
    }),
    validator("query", searchEntriesSchema, onValidationFailure),
    async (c) => {
      const query = c.req.valid("query");
      const owner = await resolveListOwner(c, query.ownerType, query.ownerId);
      const data = await searchDriveEntries(c.get("db"), owner, query.q, query.limit ?? 50);
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/entries/trash",
    describeRoute({
      tags: ["drive"],
      summary: "Empty the caller's trash",
      responses: { 200: okJson(trashEmptiedSchema), 401: errJson("Unauthenticated") },
    }),
    async (c) => {
      const user = c.get("user");
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
    },
  );

  router.post(
    "/drive/entries/text-file",
    describeRoute({
      tags: ["drive"],
      summary: "Create a text file entry",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 422: errJson("Validation error") },
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
    },
  );

  router.post(
    "/drive/entries/spreadsheet",
    describeRoute({
      tags: ["drive"],
      summary: "Create a spreadsheet entry",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 422: errJson("Validation error") },
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
    },
  );

  router.post(
    "/drive/folders",
    describeRoute({
      tags: ["drive"],
      summary: "Create a folder",
      responses: { 201: okJson(driveEntrySchema, "Created"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 422: errJson("Validation error") },
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
      responses: { 201: okJson(driveEntrySchema, "Created"), 400: errJson("No file provided"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden") },
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
    },
  );

  // Presigned direct upload (FEAT-044) — phase 1: authorize + dedup or presign.
  router.post(
    "/drive/files/presign-upload",
    describeRoute({
      tags: ["drive"],
      summary: "Begin a presigned direct upload (or finish instantly on dedup)",
      responses: { 200: okJson(z.object({ mode: z.literal("upload"), upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()) }) })), 201: okJson(z.object({ mode: z.literal("done"), entry: driveEntrySchema }), "Created (dedup)"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 409: errJson("Direct upload unavailable"), 413: errJson("Too large"), 422: errJson("Validation error") },
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
        await audit(c.get("db"), c.get("logger"), {
          actorId: user.id,
          actorName: user.name,
          action: "drive.file.uploaded",
          resourceType: "drive_entry",
          resourceId: result.entry.id,
          resourceName: result.entry.name,
          ...auditMeta(c),
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
      responses: { 201: okJson(driveEntrySchema, "Created"), 400: errJson("Upload not found"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 413: errJson("Too large"), 422: errJson("Validation error") },
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
    },
  );

  // ── Single entry ────────────────────────────────────────────────────────

  router.get(
    "/drive/entries/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Get a drive entry",
      responses: { 200: okJson(driveEntrySchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
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
        401: errJson("Unauthenticated"),
        403: errJson("Forbidden"),
        404: errJson("Not found"),
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
      responses: { 200: okJson(z.array(driveVersionSchema)), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
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
      responses: { 201: okJson(z.array(driveVersionSchema), "Created"), 400: errJson("No file provided"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
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
    },
  );

  router.post(
    "/drive/entries/:id/versions/:versionId/current",
    describeRoute({
      tags: ["drive"],
      summary: "Make a version the entry's current pointer",
      responses: { 200: okJson(z.array(driveVersionSchema)), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", versionParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id, versionId } = c.req.valid("param");
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
    },
  );

  // ── Edit lock + live content (pessimistic single-writer autosave) ───────
  // All four routes require the same "update" capability as a version upload.
  // No realtime collaboration: a single editId holds the lock at a time.

  router.post(
    "/drive/entries/:id/edit-lock",
    describeRoute({
      tags: ["drive"],
      summary: "Acquire the exclusive edit lock",
      responses: { 200: okJson(acquireEditLockResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 409: errJson("Edit lock held by another session"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", editLockSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const { editId } = c.req.valid("json");
      try {
        const result = await acquireEditLock(c.get("db"), id, editId, user.id);
        await audit(c.get("db"), c.get("logger"), {
          actorId: user.id,
          actorName: user.name,
          action: "drive.edit_lock.acquired",
          resourceType: "drive_entry",
          resourceId: entry.id,
          resourceName: entry.name,
          detail: { takenOver: result.takenOver },
          ...auditMeta(c),
          result: "success",
        });
        return c.json({ success: true, data: result });
      }
      catch (e) {
        if (e instanceof EditLockConflictError)
          return c.json({ success: false, error: { code: "DRIVE_EDIT_LOCKED", message: e.message, lockBy: e.lockBy } }, 409);
        throw e;
      }
    },
  );

  router.patch(
    "/drive/entries/:id/edit-lock/heartbeat",
    describeRoute({
      tags: ["drive"],
      summary: "Renew the edit lock heartbeat",
      responses: { 200: okJson(heartbeatEditLockResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 409: errJson("Edit lock is no longer held"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", editLockSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const { editId } = c.req.valid("json");
      // Stale/expired editId surfaces as the service's AppError(409).
      const data = await heartbeatEditLock(c.get("db"), id, editId);
      return c.json({ success: true, data });
    },
  );

  router.delete(
    "/drive/entries/:id/edit-lock",
    describeRoute({
      tags: ["drive"],
      summary: "Release the edit lock",
      responses: { 200: okJson(releaseEditLockResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const entry = await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const editId = await readEditId(c);
      const data = await releaseEditLock(c.get("db"), id, editId);
      await audit(c.get("db"), c.get("logger"), {
        actorId: user.id,
        actorName: user.name,
        action: "drive.edit_lock.released",
        resourceType: "drive_entry",
        resourceId: entry.id,
        resourceName: entry.name,
        detail: { released: data.released },
        ...auditMeta(c),
        result: "success",
      });
      return c.json({ success: true, data });
    },
  );

  router.patch(
    "/drive/entries/:id/live-content",
    describeRoute({
      tags: ["drive"],
      summary: "Autosave the live content body",
      responses: { 200: okJson(liveContentResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 409: errJson("Edit lock is no longer held"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", liveContentSchema, onValidationFailure),
    async (c) => {
      const { id } = c.req.valid("param");
      await assertEntryCapability(c.get("db"), actorOf(c), id, "update");
      const { editId, content } = c.req.valid("json");
      // Live autosave never creates a version/blob; stale/expired editId ⇒ 409.
      const data = await updateEntryLiveContent(c.get("db"), id, editId, content);
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
      responses: { 200: okJson(driveEntrySchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateEntrySchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      await driveAccess.assert(policyContext(c)!, "drive:update", id);
      const body = c.req.valid("json");
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
    },
  );

  router.post(
    "/drive/entries/:id/restore",
    describeRoute({
      tags: ["drive"],
      summary: "Restore a trashed drive entry",
      responses: { 200: okJson(driveEntrySchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
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
    },
  );

  router.delete(
    "/drive/entries/:id/permanent",
    describeRoute({
      tags: ["drive"],
      summary: "Permanently delete a drive entry",
      responses: { 200: okJson(idResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
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
    },
  );

  router.delete(
    "/drive/entries/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Move a drive entry to trash",
      responses: { 200: okJson(idResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
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
    },
  );

  // ── Team directories ──────────────────────────────────────────────────

  router.get(
    "/drive/team-directories",
    describeRoute({
      tags: ["drive"],
      summary: "List the caller's team directories",
      responses: { 200: okJson(z.array(teamDirectorySchema)), 401: errJson("Unauthenticated") },
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
      responses: { 201: okJson(teamDirectorySchema, "Created"), 401: errJson("Unauthenticated"), 422: errJson("Validation error") },
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
    },
  );

  router.get(
    "/drive/team-directories/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Get a team directory",
      responses: { 200: okJson(teamDirectorySchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
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
      responses: { 200: okJson(teamDirectorySchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", updateDirectorySchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const body = c.req.valid("json");
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
    },
  );

  router.delete(
    "/drive/team-directories/:id",
    describeRoute({
      tags: ["drive"],
      summary: "Delete a team directory",
      responses: { 200: okJson(idResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
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
    },
  );

  router.get(
    "/drive/team-directories/:id/members",
    describeRoute({
      tags: ["drive"],
      summary: "List a team directory's members",
      responses: { 200: okJson(z.array(teamMemberSchema)), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
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
      responses: { 201: okJson(teamMemberSchema, "Created"), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 422: errJson("Validation error") },
    }),
    validator("param", idParamSchema, onValidationFailure),
    validator("json", addMemberSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId } = c.req.valid("param");
      const body = c.req.valid("json");
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
    },
  );

  router.put(
    "/drive/team-directories/:id/members/:memberId",
    describeRoute({
      tags: ["drive"],
      summary: "Update a team directory member's role",
      responses: { 200: okJson(teamMemberSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found"), 422: errJson("Validation error") },
    }),
    validator("param", memberParamSchema, onValidationFailure),
    validator("json", updateMemberSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId, memberId } = c.req.valid("param");
      const body = c.req.valid("json");
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
    },
  );

  router.delete(
    "/drive/team-directories/:id/members/:memberId",
    describeRoute({
      tags: ["drive"],
      summary: "Remove a member from a team directory",
      responses: { 200: okJson(idResultSchema), 401: errJson("Unauthenticated"), 403: errJson("Forbidden"), 404: errJson("Not found") },
    }),
    validator("param", memberParamSchema, onValidationFailure),
    async (c) => {
      const user = c.get("user");
      const { id: directoryId, memberId } = c.req.valid("param");
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
