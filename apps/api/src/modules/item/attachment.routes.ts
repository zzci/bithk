import type { Context, Hono } from "hono";
import type { AppDatabase } from "@/db";
import type { ProtectedEnv } from "@/shared/lib/types";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { assertEntryCapability } from "@/modules/drive/drive.permission";
import { getDriveEntryById } from "@/modules/drive/drive.service";
import {
  addReference,
  buildDownloadResponse,
  confirmReferenceUpload,
  getFileById,
  getReferenceById,
  listAttachmentsByOwner,
  makeAttachmentView,
  presignReferenceUpload,
  releaseReference,
  uploadAndReference,
} from "@/modules/file";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { requireParam } from "@/shared/lib/route-params";

// Multipart upload (`file` field) request-body doc for attachment uploads.
const fileUploadBody = { content: { "multipart/form-data": { schema: { type: "object" as const, properties: { file: { type: "string" as const, format: "binary" } } } } } };

// Mirrors `AttachmentView` from the file module.
const attachmentViewSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  ownerType: z.string(),
  ownerId: z.string(),
  filename: z.string(),
  mimetype: z.string(),
  size: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
});
// Attach an already-stored drive file by entry id (no re-upload).
const fromDriveSchema = z.object({ entryId: z.string().min(1) });
// Presigned direct upload (FEAT-050) — mirrors the drive pair (FEAT-044).
const presignUploadSchema = z.object({
  filename: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  mimetype: z.string().min(1),
});
const confirmUploadSchema = z.object({
  filename: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mimetype: z.string().min(1),
});
const presignResponseSchema = z.object({
  mode: z.literal("upload"),
  upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()) }),
});
const presignDoneResponseSchema = z.object({ mode: z.literal("done"), attachment: attachmentViewSchema });

/**
 * Per-request permission read for one sub-type subject. Sub-types compute
 * these from their own access rules (project membership + capabilities,
 * policy engine, module gate, …) and hand the result back to the factory.
 *
 * `canDelete` is a function so the factory can pass the attachment's
 * uploader id in (most sub-types allow "uploader or manager or admin").
 */
export interface AttachmentPermissions {
  /** Can the actor list and download attachments? `false` fail-closes to 404. */
  readonly canRead: boolean;
  /** Can the actor upload / attach-from-drive? Denial style is `writeDenial`. */
  readonly canWrite: boolean;
  /** Can the actor delete this particular attachment? `false` is a 403. */
  readonly canDelete: (attachmentCreatedBy: string) => boolean;
}

export interface AttachmentSubject<TResource = unknown> {
  /** The file-registry owner id the attachments hang off (e.g. `items.id`). */
  readonly ownerId: string;
  /** Sub-type row data (e.g. the issue / procurement row). Opaque to the factory; consumed by `permissions`. */
  readonly resource: TResource;
  /** Used for `audit.resourceName`. */
  readonly resourceName: string;
  /** The sub-type's short id (the value the route param resolved to). */
  readonly externalId: string;
}

export interface MountItemAttachmentRoutesOptions<TResource = unknown> {
  /** URL prefix the sub-type mounts attachments under, e.g. `/projects/:projectId/issues`. */
  readonly routePrefix: string;
  /** Audit / error resource type, e.g. `"issue"`, `"document"`. */
  readonly resourceType: string;
  /** OpenAPI tag the routes are grouped under, e.g. `"issues"`. */
  readonly tag: string;
  /** Route summaries, kept host-supplied so the generated spec wording is stable. */
  readonly summaries: {
    readonly upload: string;
    readonly fromDrive: string;
    readonly list: string;
    readonly download: string;
    readonly delete: string;
  };
  /** File-registry owner discriminator. Defaults to `"item_attachment"`. */
  readonly ownerType?: string;
  /**
   * How `canWrite === false` surfaces on upload / attach-from-drive.
   * `"forbidden"` (default) is a 403; `"not-found"` hides the subject with a
   * 404 for hosts whose write gate doubles as a visibility gate (procurement).
   * Only `"forbidden"` documents a 403 response on the upload route.
   */
  readonly writeDenial?: "forbidden" | "not-found";
  /** Emit `<resourceType>.attachment_*` audit events. Defaults to `true`. */
  readonly auditEnabled?: boolean;
  /**
   * Resolve a route's `:id` to the parent subject. Return `null` when the
   * subject does not exist (or does not belong to the prefix's other path
   * params, e.g. `:projectId`); the factory turns that into a `NotFoundError`.
   */
  readonly resolve: (
    db: AppDatabase,
    idParam: string,
    params: Readonly<Record<string, string>>,
  ) => Promise<AttachmentSubject<TResource> | null>;
  /** Compute the actor's permission read for this subject. */
  readonly permissions: (
    db: AppDatabase,
    user: { id: string; role: string },
    subject: AttachmentSubject<TResource>,
  ) => Promise<AttachmentPermissions>;
}

/**
 * Mount the shared attachment route quartet (upload / attach-from-drive /
 * list / download / delete) onto a sub-type's router. Owned by `mod-item`
 * because attachments live in the file module's generic reference registry
 * and the route shapes are uniform across sub-types; the sub-type only wires
 * `resolve` + `permissions`. Mirrors `mountItemCommentRoutes`.
 */
export function mountItemAttachmentRoutes<TResource>(
  router: Hono<ProtectedEnv>,
  opts: MountItemAttachmentRoutesOptions<TResource>,
): void {
  const { routePrefix: prefix, resourceType, tag, summaries } = opts;
  const ownerType = opts.ownerType ?? "item_attachment";
  const writeDenial = opts.writeDenial ?? "forbidden";
  const auditEnabled = opts.auditEnabled ?? true;

  // The path params contributed by the (dynamic) prefix, e.g. `projectId` for
  // `/projects/:projectId/issues`. Merged with each route's own params so the
  // generated spec documents every `:param` in the full path.
  const prefixParams = prefix.split("/").filter(s => s.startsWith(":")).map(s => s.slice(1));
  function paramSchema(...own: string[]) {
    const shape: Record<string, z.ZodString> = {};
    for (const key of [...prefixParams, ...own])
      shape[key] = z.string();
    return z.object(shape);
  }
  const inlineQuery = z.object({ inline: z.string().optional() });

  async function load(
    c: Context<ProtectedEnv>,
  ): Promise<{ db: AppDatabase; user: { id: string; role: string; name: string }; subject: AttachmentSubject<TResource>; perms: AttachmentPermissions }> {
    const db = c.get("db");
    const user = c.get("user");
    const subject = await opts.resolve(db, requireParam(c, "id"), c.req.param());
    if (!subject)
      throw new NotFoundError(resourceType, requireParam(c, "id"));
    const perms = await opts.permissions(db, user, subject);
    // Fail closed: an actor who cannot read the subject must not be able to
    // tell "exists but forbidden" apart from "does not exist". Mirror the
    // parent routes' 404 instead of leaking existence with a 403.
    if (!perms.canRead)
      throw new NotFoundError(resourceType, subject.externalId);
    return { db, user, subject, perms };
  }

  function assertCanWrite(perms: AttachmentPermissions, subject: AttachmentSubject<TResource>): void {
    if (perms.canWrite)
      return;
    if (writeDenial === "not-found")
      throw new NotFoundError(resourceType, subject.externalId);
    throw new ForbiddenError();
  }

  // Resolve an `:aid` to a reference owned by this subject; anything else
  // (missing, foreign owner type, another subject's attachment) is a 404.
  async function loadOwnedReference(db: AppDatabase, subject: AttachmentSubject<TResource>, aid: string) {
    const ref = await getReferenceById(db, aid);
    if (!ref || ref.ownerType !== ownerType || ref.ownerId !== subject.ownerId)
      throw new NotFoundError("Attachment", aid);
    return ref;
  }

  router.post(
    `${prefix}/:id/attachments`,
    describeRoute({
      tags: [tag],
      summary: summaries.upload,
      requestBody: fileUploadBody,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "No file provided", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        ...(writeDenial === "forbidden" ? { 403: { description: "Forbidden", ...errorJson } } : {}),
        404: { description: "Not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    async (c) => {
      const { db, user, subject, perms } = await load(c);
      assertCanWrite(perms, subject);

      const config = c.get("config");
      const contentLength = Number(c.req.header("content-length") ?? "0");
      if (contentLength > config.MAX_UPLOAD_BYTES)
        throw new AppError("Upload too large", 413, "UPLOAD_TOO_LARGE");

      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File))
        throw new AppError("No file provided", 400, "VALIDATION_ERROR");

      const { reference, file: uploaded } = await uploadAndReference(db, config, {
        file,
        ownerType,
        ownerId: subject.ownerId,
        uploadedBy: user.id,
      });
      const view = makeAttachmentView(reference, uploaded);

      if (auditEnabled) {
        await auditFromCtx(c, {
          action: `${resourceType}.attachment_uploaded`,
          resourceType,
          resourceId: subject.externalId,
          resourceName: subject.resourceName,
          detail: { attachmentId: reference.id, filename: file.name, size: file.size },
          result: "success",
        });
      }

      return c.json({ success: true, data: view }, 201);
    },
  );

  // Presigned direct upload (FEAT-050) — phase 1: authorize exactly like the
  // multipart route, then dedup-or-presign. Phase 2 registers the object.
  router.post(
    `${prefix}/:id/attachments/presign-upload`,
    describeRoute({
      tags: [tag],
      summary: `${summaries.upload} (presign direct upload)`,
      responses: {
        200: okJson(presignResponseSchema),
        201: okJson(presignDoneResponseSchema, "Created (dedup)"),
        401: { description: "Unauthenticated", ...errorJson },
        ...(writeDenial === "forbidden" ? { 403: { description: "Forbidden", ...errorJson } } : {}),
        404: { description: "Not found", ...errorJson },
        409: { description: "Direct upload unavailable", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    validator("json", presignUploadSchema, onValidationFailure),
    async (c) => {
      const { db, user, subject, perms } = await load(c);
      assertCanWrite(perms, subject);
      const body = c.req.valid("json");

      const result = await presignReferenceUpload(db, c.get("config"), {
        ownerType,
        ownerId: subject.ownerId,
        filename: body.filename,
        sha256: body.sha256,
        size: body.size,
        mimetype: body.mimetype,
        uploadedBy: user.id,
      });
      if (result.mode === "done") {
        const view = makeAttachmentView(result.reference, result.file);
        if (auditEnabled) {
          await auditFromCtx(c, {
            action: `${resourceType}.attachment_uploaded`,
            resourceType,
            resourceId: subject.externalId,
            resourceName: subject.resourceName,
            detail: { attachmentId: result.reference.id, filename: body.filename, size: result.file.size },
            result: "success",
          });
        }
        return c.json({ success: true, data: { mode: "done", attachment: view } }, 201);
      }
      return c.json({ success: true, data: { mode: "upload", upload: result.upload } });
    },
  );

  // Presigned direct upload (FEAT-050) — phase 2: register the uploaded object.
  router.post(
    `${prefix}/:id/attachments/confirm-upload`,
    describeRoute({
      tags: [tag],
      summary: `${summaries.upload} (confirm direct upload)`,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "Upload not found", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        ...(writeDenial === "forbidden" ? { 403: { description: "Forbidden", ...errorJson } } : {}),
        404: { description: "Not found", ...errorJson },
        413: { description: "Upload too large", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    validator("json", confirmUploadSchema, onValidationFailure),
    async (c) => {
      const { db, user, subject, perms } = await load(c);
      assertCanWrite(perms, subject);
      const body = c.req.valid("json");

      const { reference, file: uploaded } = await confirmReferenceUpload(db, c.get("config"), {
        ownerType,
        ownerId: subject.ownerId,
        filename: body.filename,
        sha256: body.sha256,
        mimetype: body.mimetype,
        uploadedBy: user.id,
      });
      const view = makeAttachmentView(reference, uploaded);

      if (auditEnabled) {
        await auditFromCtx(c, {
          action: `${resourceType}.attachment_uploaded`,
          resourceType,
          resourceId: subject.externalId,
          resourceName: subject.resourceName,
          detail: { attachmentId: reference.id, filename: body.filename, size: uploaded.size },
          result: "success",
        });
      }
      return c.json({ success: true, data: view }, 201);
    },
  );

  // Attach an existing drive file to this subject without re-uploading the
  // blob: register a new reference to the entry's already-stored file. The
  // actor's READ access on the drive entry is verified server-side — the
  // client-supplied id is never trusted.
  router.post(
    `${prefix}/:id/attachments/from-drive`,
    describeRoute({
      tags: [tag],
      summary: summaries.fromDrive,
      responses: {
        201: okJson(attachmentViewSchema, "Created"),
        400: { description: "Drive entry is not a file or already attached", ...errorJson },
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    validator("json", fromDriveSchema, onValidationFailure),
    async (c) => {
      const { db, user, subject, perms } = await load(c);
      assertCanWrite(perms, subject);
      const { entryId } = c.req.valid("json");

      // Authoritative READ check on the drive entry (throws 404/403).
      const actor = { id: user.id, role: user.role };
      await assertEntryCapability(db, actor, entryId, "read");
      const entry = await getDriveEntryById(db, entryId);
      if (!entry || !entry.file)
        throw new AppError("Drive entry is not a file", 400, "INVALID_ENTRY");

      const reference = await addReference(db, {
        fileId: entry.file.fileId,
        ownerType,
        ownerId: subject.ownerId,
        filename: entry.name,
        createdBy: user.id,
      });
      const fileRow = await getFileById(db, entry.file.fileId);
      const view = makeAttachmentView(reference, fileRow!);

      if (auditEnabled) {
        await auditFromCtx(c, {
          action: `${resourceType}.attachment_attached_from_drive`,
          resourceType,
          resourceId: subject.externalId,
          resourceName: subject.resourceName,
          detail: { attachmentId: reference.id, entryId, filename: entry.name },
          result: "success",
        });
      }

      return c.json({ success: true, data: view }, 201);
    },
  );

  router.get(
    `${prefix}/:id/attachments`,
    describeRoute({
      tags: [tag],
      summary: summaries.list,
      responses: {
        200: okJson(z.array(attachmentViewSchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id"), onValidationFailure),
    async (c) => {
      const { db, subject } = await load(c);
      const data = await listAttachmentsByOwner(db, ownerType, subject.ownerId);
      return c.json({ success: true, data });
    },
  );

  router.get(
    `${prefix}/:id/attachments/:aid`,
    describeRoute({
      tags: [tag],
      summary: summaries.download,
      responses: {
        200: { description: "Attachment file stream", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "aid"), onValidationFailure),
    validator("query", inlineQuery, onValidationFailure),
    async (c) => {
      const { db, subject } = await load(c);
      const aid = requireParam(c, "aid");
      const ref = await loadOwnedReference(db, subject, aid);
      const fileRow = await getFileById(db, ref.fileId);
      if (!fileRow)
        throw new NotFoundError("File", aid);
      const wantInline = c.req.valid("query").inline === "true";
      return await buildDownloadResponse(c.get("config"), fileRow, ref, { inline: wantInline });
    },
  );

  router.delete(
    `${prefix}/:id/attachments/:aid`,
    describeRoute({
      tags: [tag],
      summary: summaries.delete,
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", paramSchema("id", "aid"), onValidationFailure),
    async (c) => {
      const { db, subject, perms } = await load(c);
      const aid = requireParam(c, "aid");
      const ref = await loadOwnedReference(db, subject, aid);
      if (!perms.canDelete(ref.createdBy))
        throw new ForbiddenError();
      await releaseReference(db, c.get("config"), { referenceId: aid });

      if (auditEnabled) {
        await auditFromCtx(c, {
          action: `${resourceType}.attachment_deleted`,
          resourceType,
          resourceId: subject.externalId,
          resourceName: subject.resourceName,
          detail: { attachmentId: aid, filename: ref.filename },
          result: "success",
        });
      }

      return c.json({ success: true, data: null });
    },
  );
}
