import type { Context, Hono } from "hono";
import type { ProjectCapability } from "@/modules/project/schema";
import type { ProtectedEnv } from "@/shared/lib/types";
import { z } from "zod";
import { getMemberCapabilities, resolveProjectId } from "@/modules/project/project.service";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { adminRequired } from "@/shared/middleware/auth";
import {
  composeCategory,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "./procurement.categories";
import {
  composeGlobalCategory,
  createGlobalCategory,
  deleteGlobalCategory,
  listGlobalCategories,
  updateGlobalCategory,
} from "./procurement.global-categories";

// Procurement-category routes (PLAN-108 §3). Re-homed verbatim from the project
// module together with the two tables they read: categories are
// procurement-domain data, so the module that owns `categories.manage` owns the
// endpoints too. Paths, capability gates and response shapes are unchanged —
// this is a move, not a redesign, and both surfaces stay mounted at "/" so the
// URLs are identical to before.

const createGlobalCategorySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateGlobalCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

const idParam = z.object({ id: z.string() });
const categoryParam = z.object({ id: z.string(), categoryId: z.string() });

// Shared shape for project + global procurement categories.
const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Resolve the project id from the `:id` short id and assert the actor is a
 * member (and, when `capability` is given, that their role grants it). App
 * admins bypass membership with the full capability set. Fail-closed: a
 * missing project or non-member both surface as 404 so membership is not
 * leaked. Mirrors the project module's own `requireProject` — the category
 * routes kept their exact gating when they moved here.
 */
async function requireProject(
  c: Context<ProtectedEnv>,
  shortId: string,
  capability?: ProjectCapability,
): Promise<{ projectId: string }> {
  const db = c.get("db");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  if (c.get("user").role === "admin")
    return { projectId };
  const caps = await getMemberCapabilities(db, projectId, c.get("user").id);
  if (caps === null)
    throw new NotFoundError("Project", shortId);
  if (capability && !caps.has(capability))
    throw new ForbiddenError(`Capability '${capability}' required`);
  return { projectId };
}

/**
 * Mount the global + per-project procurement-category routes onto the
 * procurement router. Additive — the procurement core routes are untouched.
 */
export function mountProcurementCategoryRoutes(router: Hono<ProtectedEnv>): void {
  // ─── Global procurement categories (admin only) ────────────────────
  // The template set copied into each new project at creation (copy-on-create).
  router.get(
    "/global-procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "List global procurement categories",
      responses: {
        200: okJson(z.array(categorySchema)),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Admin only", ...errorJson },
      },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: (await listGlobalCategories(db)).map(composeGlobalCategory) });
    },
  );

  router.post(
    "/global-procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "Create a global procurement category",
      responses: {
        201: okJson(categorySchema, "Created"),
        403: { description: "Admin only", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("json", createGlobalCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createGlobalCategory(db, body);
      return c.json({ success: true, data: composeGlobalCategory(category) }, 201);
    },
  );

  router.patch(
    "/global-procurement-categories/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Update a global procurement category",
      responses: {
        200: okJson(categorySchema),
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParam, onValidationFailure),
    validator("json", updateGlobalCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const category = await updateGlobalCategory(db, id, body);
      if (!category)
        throw new NotFoundError("Global procurement category", id);
      return c.json({ success: true, data: composeGlobalCategory(category) });
    },
  );

  router.delete(
    "/global-procurement-categories/:id",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a global procurement category",
      responses: {
        200: okJson(z.null()),
        403: { description: "Admin only", ...errorJson },
        404: { description: "Not found", ...errorJson },
      },
    }),
    adminRequired,
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      if (!await deleteGlobalCategory(db, id))
        throw new NotFoundError("Global procurement category", id);
      return c.json({ success: true, data: null });
    },
  );

  // ─── Procurement categories ────────────────────────────────────────
  router.get(
    "/projects/:id/procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "List project procurement categories",
      responses: {
        200: okJson(z.array(categorySchema)),
        401: { description: "Unauthenticated", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id);
      const db = c.get("db");
      return c.json({ success: true, data: (await listCategories(db, projectId)).map(composeCategory) });
    },
  );

  router.post(
    "/projects/:id/procurement-categories",
    describeRoute({
      tags: ["projects"],
      summary: "Create a project procurement category",
      responses: {
        201: okJson(categorySchema, "Created"),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Project not found or not a member", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", idParam, onValidationFailure),
    validator("json", createCategorySchema, onValidationFailure),
    async (c) => {
      const { projectId } = await requireProject(c, c.req.valid("param").id, "categories.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createCategory(db, projectId, body);
      return c.json({ success: true, data: composeCategory(category) }, 201);
    },
  );

  router.patch(
    "/projects/:id/procurement-categories/:categoryId",
    describeRoute({
      tags: ["projects"],
      summary: "Update a project procurement category",
      responses: {
        200: okJson(categorySchema),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Procurement category not found", ...errorJson },
        422: { description: "Validation error", ...errorJson },
      },
    }),
    validator("param", categoryParam, onValidationFailure),
    validator("json", updateCategorySchema, onValidationFailure),
    async (c) => {
      const { id, categoryId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "categories.manage");
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await updateCategory(db, projectId, categoryId, body);
      if (!category)
        throw new NotFoundError("Procurement category", categoryId);
      return c.json({ success: true, data: composeCategory(category) });
    },
  );

  router.delete(
    "/projects/:id/procurement-categories/:categoryId",
    describeRoute({
      tags: ["projects"],
      summary: "Delete a project procurement category",
      responses: {
        200: okJson(z.null()),
        401: { description: "Unauthenticated", ...errorJson },
        403: { description: "Forbidden", ...errorJson },
        404: { description: "Procurement category not found", ...errorJson },
      },
    }),
    validator("param", categoryParam, onValidationFailure),
    async (c) => {
      const { id, categoryId } = c.req.valid("param");
      const { projectId } = await requireProject(c, id, "categories.manage");
      const db = c.get("db");
      const removed = await deleteCategory(db, projectId, categoryId);
      if (!removed)
        throw new NotFoundError("Procurement category", categoryId);
      return c.json({ success: true, data: null });
    },
  );
}
