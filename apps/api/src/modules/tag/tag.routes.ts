import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { describeRoute, ErrorEnvelope, onValidationFailure, resolver, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { TAG_TYPES } from "./schema";
import { createTag, deleteTag, listTagsWithUsage, renameTag } from "./tag.service";

// `/tags` manages all typed vocabularies (project/contact/document/issue/
// procurement) over the shared `tags` table; the generic `tags_refs` join
// supplies the assignment count. `type` defaults to project so existing
// project-only callers are unchanged.
const tagTypeSchema = z.enum(TAG_TYPES).default("project");
const tagBodySchema = z.object({ name: z.string().min(1).max(50), type: tagTypeSchema });
const tagQuerySchema = z.object({ type: tagTypeSchema });
const idParamSchema = z.object({ id: z.string() });

const tagSchema = z.object({ id: z.string(), type: z.string(), name: z.string() });
const tagWithUsageSchema = tagSchema.extend({ usageCount: z.number() });

// `{ success:true, data }` response doc for `schema`.
function okJson(schema: z.ZodType, description = "Success") {
  return { description, content: { "application/json": { schema: resolver(z.object({ success: z.literal(true), data: schema })) } } };
}
const errorJson = { content: { "application/json": { schema: resolver(ErrorEnvelope) } } };

export function tagRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // GET /tags[?type=] — typed tag vocabulary with usage counts (for the list
  // filter). `type` defaults to project.
  router.get(
    "/tags",
    describeRoute({
      tags: ["tags"],
      summary: "List tags with usage counts",
      responses: { 200: okJson(z.array(tagWithUsageSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    validator("query", tagQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { type } = c.req.valid("query");
      return c.json({ success: true, data: await listTagsWithUsage(db, type) });
    },
  );

  // ─── Tag admin (admin only) ────────────────────────────────────────
  router.post(
    "/tags",
    describeRoute({
      tags: ["tags"],
      summary: "Create a tag",
      responses: { 201: okJson(tagSchema, "Created"), 403: { description: "Admin only", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", tagBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      return c.json({ success: true, data: await createTag(db, body.type, body.name) }, 201);
    },
  );

  router.patch(
    "/tags/:id",
    describeRoute({
      tags: ["tags"],
      summary: "Rename a tag",
      responses: { 200: okJson(tagSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("json", tagBodySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const tag = await renameTag(db, body.type, id, body.name);
      if (!tag)
        throw new NotFoundError("Tag", id);
      return c.json({ success: true, data: tag });
    },
  );

  // Delete a tag, cascade-unlinking it from every assignment (no in-use block).
  router.delete(
    "/tags/:id",
    describeRoute({
      tags: ["tags"],
      summary: "Delete a tag",
      responses: { 200: okJson(z.null()), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", idParamSchema, onValidationFailure),
    validator("query", tagQuerySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const { type } = c.req.valid("query");
      if (!await deleteTag(db, type, id))
        throw new NotFoundError("Tag", id);
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
