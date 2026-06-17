import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { authRequired } from "@/shared/middleware/auth";
import { buildDownloadResponse, getFileById, getReferenceById } from "./file.service";
import { getFilePermissionHook } from "./permission";

const fileParamSchema = z.object({ id: z.string() });
// `ref`/`inline` are optional: a missing `ref` is answered with a 404 (existence
// hidden), not a validation error, so they stay free-form here.
const metadataQuerySchema = z.object({ ref: z.string().optional() });
const contentQuerySchema = z.object({ ref: z.string().optional(), inline: z.string().optional() });

const fileMetadataSchema = z.object({
  id: z.string(),
  size: z.number(),
  mimetype: z.string(),
  filename: z.string(),
  ownerType: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
});

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

/**
 * The `file` module exposes a tiny pair of read endpoints. **Uploads do
 * not happen here** — every upload comes in through the parent
 * resource's route (e.g. `POST /api/items/:id/attachments`) so the
 * per-resource permission stays at the consumer boundary.
 *
 * Both endpoints take `ref=<reference id>` so we know which consumer
 * relationship to authorise against. The active permission hook (looked
 * up by `reference.ownerType`) decides whether the actor can read /
 * delete. A 404 — never 403 — is returned when no hook is registered
 * for the owner type, so the existence of an unclaimed owner_type is
 * not leaked.
 */
export function fileRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.get(
    "/files/:id/metadata",
    describeRoute({
      tags: ["infra1"],
      summary: "Get file metadata",
      responses: {
        200: okJson(fileMetadataSchema),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", fileParamSchema, onValidationFailure),
    validator("query", metadataQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const refId = c.req.valid("query").ref;
      if (!refId)
        throw new NotFoundError("File", id);

      const ref = await getReferenceById(db, refId);
      if (!ref || ref.fileId !== id)
        throw new NotFoundError("File", id);

      const hook = getFilePermissionHook(ref.ownerType);
      if (!hook)
        throw new NotFoundError("File", id);

      const allowed = await hook.canRead(db, { id: user.id, role: user.role }, ref);
      if (!allowed)
        throw new NotFoundError("File", id);

      const file = await getFileById(db, id);
      if (!file)
        throw new NotFoundError("File", id);

      return c.json({
        success: true,
        data: {
          id: file.id,
          size: file.size,
          mimetype: file.mimetype,
          filename: ref.filename,
          ownerType: ref.ownerType,
          ownerId: ref.ownerId,
          createdAt: ref.createdAt,
        },
      });
    },
  );

  router.get(
    "/files/:id/content",
    describeRoute({
      tags: ["infra1"],
      summary: "Download file content",
      responses: {
        200: { description: "File bytes", content: { "application/octet-stream": { schema: resolver(z.string()) } } },
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    validator("param", fileParamSchema, onValidationFailure),
    validator("query", contentQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const query = c.req.valid("query");
      const refId = query.ref;
      const wantInline = query.inline === "true";
      if (!refId)
        throw new NotFoundError("File", id);

      const ref = await getReferenceById(db, refId);
      if (!ref || ref.fileId !== id)
        throw new NotFoundError("File", id);

      const hook = getFilePermissionHook(ref.ownerType);
      if (!hook)
        throw new NotFoundError("File", id);

      const allowed = await hook.canRead(db, { id: user.id, role: user.role }, ref);
      if (!allowed) {
        // No read relationship to the owning resource ⇒ hide existence with a
        // 404, matching the metadata route above and the codebase-wide
        // fail-closed policy. 403 is reserved for callers who can already see
        // the resource but lack a specific capability — not the case here,
        // where `canRead` is the existence gate itself. See decision 003.
        throw new NotFoundError("File", id);
      }

      const file = await getFileById(db, id);
      if (!file)
        throw new NotFoundError("File", id);

      return await buildDownloadResponse(c.get("config"), file, ref, { inline: wantInline });
    },
  );

  return router;
}
