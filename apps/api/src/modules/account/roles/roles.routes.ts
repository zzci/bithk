import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import {
  composeGlobalRole,
  createGlobalRole,
  deleteGlobalRole,
  listGlobalRoles,
  updateGlobalRole,
} from "./roles.service";

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  modules: z.array(z.string()).default([]),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  modules: z.array(z.string()).optional(),
}).refine(
  d => d.name !== undefined || d.modules !== undefined,
  { message: "At least one of name or modules must be provided" },
);

// Global roles CRUD (admin only) — app-level module visibility. Follows the
// top-level `/global-*` admin vocabulary convention (procurement categories,
// equipment categories/manufacturers).
export function roleRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.get("/global-roles", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: (await listGlobalRoles(db)).map(composeGlobalRole) });
  });

  router.post("/global-roles", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createRoleSchema.parse(await c.req.json());
    const role = await createGlobalRole(db, body);
    return c.json({ success: true, data: composeGlobalRole(role) }, 201);
  });

  router.patch("/global-roles/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateRoleSchema.parse(await c.req.json());
    const role = await updateGlobalRole(db, id, body);
    if (!role)
      throw new NotFoundError("Global role", id);
    return c.json({ success: true, data: composeGlobalRole(role) });
  });

  router.delete("/global-roles/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const result = await deleteGlobalRole(db, id);
    if (result === "not_found")
      throw new NotFoundError("Global role", id);
    if (result === "system")
      throw new ForbiddenError("System roles cannot be deleted");
    return c.json({ success: true, data: null });
  });

  return router;
}
