import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { TAG_TYPES } from "./schema";
import { createTag, deleteTag, listTagsWithUsage, renameTag } from "./tag.service";

// `/tags` manages all typed vocabularies (project/contact/document/issue/
// procurement) over the shared `tags` table; the generic `tags_refs` join
// supplies the assignment count. `type` defaults to project so existing
// project-only callers are unchanged.
const tagTypeSchema = z.enum(TAG_TYPES).default("project");
const tagNameSchema = z.object({ name: z.string().min(1).max(50), type: tagTypeSchema });

export function tagRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // GET /tags[?type=] — typed tag vocabulary with usage counts (for the list
  // filter). `type` defaults to project.
  router.get("/tags", async (c) => {
    const db = c.get("db");
    const type = tagTypeSchema.parse(c.req.query("type"));
    return c.json({ success: true, data: await listTagsWithUsage(db, type) });
  });

  // ─── Tag admin (admin only) ────────────────────────────────────────
  router.post("/tags", adminRequired, async (c) => {
    const db = c.get("db");
    const body = tagNameSchema.parse(await c.req.json());
    return c.json({ success: true, data: await createTag(db, body.type, body.name) }, 201);
  });

  router.patch("/tags/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = tagNameSchema.parse(await c.req.json());
    const tag = await renameTag(db, body.type, id, body.name);
    if (!tag)
      throw new NotFoundError("Tag", id);
    return c.json({ success: true, data: tag });
  });

  // Delete a tag, cascade-unlinking it from every assignment (no in-use block).
  router.delete("/tags/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const type = tagTypeSchema.parse(c.req.query("type"));
    if (!await deleteTag(db, type, id))
      throw new NotFoundError("Tag", id);
    return c.json({ success: true, data: null });
  });

  return router;
}
