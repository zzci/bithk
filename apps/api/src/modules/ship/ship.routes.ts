import type { Context } from "hono";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { auditFromCtx } from "@/modules/audit/audit.context";
import { getMemberCapabilities, resolveProjectId } from "@/modules/project/project.service";
import { requireSection } from "@/modules/project/section.middleware";
import { ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { EQUIPMENT_STATUSES, SHIP_STATUSES } from "./schema";
import {
  createEquipment,
  deleteEquipment,
  getEquipment,
  listEquipment,
  updateEquipment,
} from "./ship.equipment.service";
import {
  composeGlobalEquipmentCategory,
  createGlobalEquipmentCategory,
  deleteGlobalEquipmentCategory,
  listGlobalEquipmentCategories,
  resolveGlobalEquipmentCategory,
  updateGlobalEquipmentCategory,
} from "./ship.global-equipment-category.service";
import {
  composeGlobalEquipmentManufacturer,
  createGlobalEquipmentManufacturer,
  deleteGlobalEquipmentManufacturer,
  listGlobalEquipmentManufacturers,
  resolveGlobalEquipmentManufacturer,
  updateGlobalEquipmentManufacturer,
} from "./ship.global-equipment-manufacturer.service";
import {
  composeShipProfile,
  getShipProfile,
  updateShipProfile,
  updateShipProfileSchema,
} from "./ship.profile.service";
import {
  composeProjectEquipmentCategory,
  createProjectEquipmentCategory,
  deleteProjectEquipmentCategory,
  listProjectEquipmentCategories,
  resolveProjectEquipmentCategory,
  updateProjectEquipmentCategory,
} from "./ship.ship-equipment-category.service";
import {
  createProjectWorklist,
  createProjectWorklistSchema,
  deleteProjectWorklist,
  getProjectWorklist,
  listProjectWorklists,
  listReferenceableWorklists,
  updateProjectWorklist,
  updateWorklistSchema,
} from "./ship.worklist.service";

const equipmentCoreShape = {
  categoryId: z.string().min(1).nullable().optional(),
  manufacturerId: z.string().min(1).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  serialNumber: z.string().max(255).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  // B8: must be an ISO 8601 datetime (e.g. "2024-01-31T00:00:00Z"), not free text.
  installedAt: z.string().datetime().nullable().optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  note: z.string().max(2000).nullable().optional(),
};

const createEquipmentSchema = z.object({
  name: z.string().min(1).max(255),
  ...equipmentCoreShape,
});

const updateEquipmentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  ...equipmentCoreShape,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const idSchema = z.string().min(1);
const projectIdParam = z.object({ projectId: z.string() });

// Bilingual names are required and unique (1..100, trimmed); code/description
// are optional metadata (0..200). `.trim()` rejects blank-after-trim names with
// a 422 before the row reaches the service.
const equipmentCategoryFields = {
  code: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
};

const createEquipmentCategorySchema = z.object({
  nameZh: z.string().trim().min(1).max(100),
  nameEn: z.string().trim().min(1).max(100),
  ...equipmentCategoryFields,
});

const updateEquipmentCategorySchema = z.object({
  nameZh: z.string().trim().min(1).max(100).optional(),
  nameEn: z.string().trim().min(1).max(100).optional(),
  ...equipmentCategoryFields,
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

// A manufacturer is a single canonical proper-noun `name` (1..100, trimmed) plus
// optional code/description metadata (0..200). `.trim()` rejects blank-after-trim
// names with a 422 before the row reaches the service.
const createManufacturerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
});

const updateManufacturerSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
}).refine(v => Object.values(v).some(value => value !== undefined), { message: "At least one field must be provided" });

// ─── Response schemas (mirror the service view types for the OpenAPI spec) ───
const tagRefSchema = z.object({ id: z.string(), name: z.string() });

const shipProfileViewSchema = z.object({
  hullNumber: z.string(),
  shipStatus: z.enum(SHIP_STATUSES),
  model: z.string().nullable(),
  builder: z.string().nullable(),
  buildYear: z.number().nullable(),
  lengthOverall: z.number().nullable(),
  beam: z.number().nullable(),
  draft: z.number().nullable(),
  airDraft: z.number().nullable(),
  grossTonnage: z.number().nullable(),
  imoNumber: z.string().nullable(),
  mmsi: z.string().nullable(),
  callSign: z.string().nullable(),
  flagState: z.string().nullable(),
  registryPort: z.string().nullable(),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const equipmentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().nullable(),
  categoryNameZh: z.string().nullable(),
  categoryNameEn: z.string().nullable(),
  manufacturerId: z.string().nullable(),
  manufacturerName: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  location: z.string().nullable(),
  installedAt: z.string().nullable(),
  status: z.enum(EQUIPMENT_STATUSES),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Global and per-project equipment categories share an identical external shape.
const equipmentCategoryViewSchema = z.object({
  id: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const manufacturerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const worklistViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(tagRefSchema),
  checklist: z.string().nullable(),
  precautions: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const referenceableWorklistsSchema = z.object({
  ship: z.array(worklistViewSchema),
  global: z.array(worklistViewSchema),
});

/**
 * Resolve the internal project id and assert the actor may READ this section:
 * app admin, or a member of the project. `requireSection` has already proved
 * the project exists and has the section mounted, so the only remaining check
 * is membership. Fail-closed: a non-member gets the same 404 (docs/decisions/003).
 *
 * The three ship sections add no capabilities of their own (PLAN-108 §4): read
 * is plain membership and write is `project.manage`, exactly today's gating.
 */
async function requireProjectRead(c: Context<ProtectedEnv>, shortId: string): Promise<string> {
  const db = c.get("db");
  const user = c.get("user");
  const projectId = await resolveProjectId(db, shortId);
  if (!projectId)
    throw new NotFoundError("Project", shortId);
  if (user.role === "admin")
    return projectId;
  const caps = await getMemberCapabilities(db, projectId, user.id);
  if (caps === null)
    throw new NotFoundError("Project", shortId);
  return projectId;
}

/** Read access first (404 fail-closed), then `project.manage` (else 403). */
async function requireProjectManage(c: Context<ProtectedEnv>, shortId: string): Promise<string> {
  const db = c.get("db");
  const user = c.get("user");
  const projectId = await requireProjectRead(c, shortId);
  if (user.role === "admin")
    return projectId;
  const caps = await getMemberCapabilities(db, projectId, user.id);
  if (!caps?.has("project.manage"))
    throw new ForbiddenError("Capability 'project.manage' required");
  return projectId;
}

export function shipRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── Global equipment-category template (bilingual vocabulary, admin only) ───
  // The admin-maintained template set copied per-project into
  // `ship_equipment_categories` when the `equipment` section is provisioned.
  // Every verb is admin-only and mutations are audited, matching the global
  // worklist knowledge-base routes. Mirrors the global procurement-categories
  // pattern.
  router.get(
    "/global-equipment-categories",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "List global equipment-category templates",
      responses: { 200: okJson(z.array(equipmentCategoryViewSchema)), 403: { description: "Admin only", ...errorJson } },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: (await listGlobalEquipmentCategories(db)).map(composeGlobalEquipmentCategory) });
    },
  );

  router.post(
    "/global-equipment-categories",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Create a global equipment-category template",
      responses: { 201: okJson(equipmentCategoryViewSchema, "Created"), 403: { description: "Admin only", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createEquipmentCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const category = await createGlobalEquipmentCategory(db, body);
      await auditFromCtx(c, {
        action: "global_equipment_category.created",
        resourceType: "global_equipment_category",
        resourceId: category.id,
        resourceName: category.nameZh,
        result: "success",
      });
      return c.json({ success: true, data: composeGlobalEquipmentCategory(category) }, 201);
    },
  );

  router.get(
    "/global-equipment-categories/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Get a global equipment-category template",
      responses: { 200: okJson(equipmentCategoryViewSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const category = await resolveGlobalEquipmentCategory(db, id);
      if (!category)
        throw new NotFoundError("Equipment category", id);
      return c.json({ success: true, data: composeGlobalEquipmentCategory(category) });
    },
  );

  router.patch(
    "/global-equipment-categories/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Update a global equipment-category template",
      responses: { 200: okJson(equipmentCategoryViewSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    validator("json", updateEquipmentCategorySchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const category = await updateGlobalEquipmentCategory(db, id, body);
      if (!category)
        throw new NotFoundError("Equipment category", id);
      await auditFromCtx(c, {
        action: "global_equipment_category.updated",
        resourceType: "global_equipment_category",
        resourceId: category.id,
        resourceName: category.nameZh,
        result: "success",
      });
      return c.json({ success: true, data: composeGlobalEquipmentCategory(category) });
    },
  );

  router.delete(
    "/global-equipment-categories/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Delete a global equipment-category template",
      responses: { 200: okJson(z.null()), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const category = await resolveGlobalEquipmentCategory(db, id);
      if (!category || !await deleteGlobalEquipmentCategory(db, id))
        throw new NotFoundError("Equipment category", id);
      await auditFromCtx(c, {
        action: "global_equipment_category.deleted",
        resourceType: "global_equipment_category",
        resourceId: category.id,
        resourceName: category.nameZh,
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ─── Global equipment-manufacturer vocabulary (admin only) ───────────────
  // A standalone admin-maintained brand list referenced directly by
  // `ship_equipment.manufacturer_id` (no per-project copy). Every verb is
  // admin-only and mutations are audited, matching the global equipment-category
  // routes above.
  router.get(
    "/global-equipment-manufacturers",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "List global equipment manufacturers",
      responses: { 200: okJson(z.array(manufacturerViewSchema)), 403: { description: "Admin only", ...errorJson } },
    }),
    adminRequired,
    async (c) => {
      const db = c.get("db");
      return c.json({ success: true, data: (await listGlobalEquipmentManufacturers(db)).map(composeGlobalEquipmentManufacturer) });
    },
  );

  router.post(
    "/global-equipment-manufacturers",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Create a global equipment manufacturer",
      responses: { 201: okJson(manufacturerViewSchema, "Created"), 403: { description: "Admin only", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createManufacturerSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const manufacturer = await createGlobalEquipmentManufacturer(db, body);
      await auditFromCtx(c, {
        action: "equipment_manufacturer.created",
        resourceType: "equipment_manufacturer",
        resourceId: manufacturer.id,
        resourceName: manufacturer.name,
        result: "success",
      });
      return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) }, 201);
    },
  );

  router.get(
    "/global-equipment-manufacturers/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Get a global equipment manufacturer",
      responses: { 200: okJson(manufacturerViewSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const manufacturer = await resolveGlobalEquipmentManufacturer(db, id);
      if (!manufacturer)
        throw new NotFoundError("Equipment manufacturer", id);
      return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) });
    },
  );

  router.patch(
    "/global-equipment-manufacturers/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Update a global equipment manufacturer",
      responses: { 200: okJson(manufacturerViewSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    validator("json", updateManufacturerSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const manufacturer = await updateGlobalEquipmentManufacturer(db, id, body);
      if (!manufacturer)
        throw new NotFoundError("Equipment manufacturer", id);
      await auditFromCtx(c, {
        action: "equipment_manufacturer.updated",
        resourceType: "equipment_manufacturer",
        resourceId: manufacturer.id,
        resourceName: manufacturer.name,
        result: "success",
      });
      return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) });
    },
  );

  router.delete(
    "/global-equipment-manufacturers/:id",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Delete a global equipment manufacturer",
      responses: { 200: okJson(z.null()), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: idSchema }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const manufacturer = await resolveGlobalEquipmentManufacturer(db, id);
      if (!manufacturer || !await deleteGlobalEquipmentManufacturer(db, id))
        throw new NotFoundError("Equipment manufacturer", id);
      await auditFromCtx(c, {
        action: "equipment_manufacturer.deleted",
        resourceType: "equipment_manufacturer",
        resourceId: manufacturer.id,
        resourceName: manufacturer.name,
        result: "success",
      });
      return c.json({ success: true, data: null });
    },
  );

  // ─── `ship-profile` section ──────────────────────────────────────────────
  // The vessel particulars of a project created with the `ship` preset. Name,
  // description, cover, tags and status live on the project itself; only the
  // maritime attributes are here. `requireSection` 404s a project that has not
  // mounted the section, so a general project has no ship surface at all.
  router.get(
    "/projects/:projectId/ship-profile",
    describeRoute({
      tags: ["ships"],
      summary: "Get a project's ship profile",
      responses: { 200: okJson(shipProfileViewSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    requireSection("ship-profile"),
    async (c) => {
      const shortId = c.req.valid("param").projectId;
      const projectId = await requireProjectRead(c, shortId);
      const profile = await getShipProfile(c.get("db"), projectId);
      if (!profile)
        throw new NotFoundError("Ship profile", shortId);
      return c.json({ success: true, data: composeShipProfile(profile) });
    },
  );

  router.put(
    "/projects/:projectId/ship-profile",
    describeRoute({
      tags: ["ships"],
      summary: "Update a project's ship profile",
      responses: { 200: okJson(shipProfileViewSchema), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", updateShipProfileSchema, onValidationFailure),
    requireSection("ship-profile"),
    async (c) => {
      const shortId = c.req.valid("param").projectId;
      const projectId = await requireProjectManage(c, shortId);
      const updated = await updateShipProfile(c.get("db"), projectId, c.req.valid("json"));
      if (!updated)
        throw new NotFoundError("Ship profile", shortId);
      return c.json({ success: true, data: composeShipProfile(updated) });
    },
  );

  // ─── `equipment` section: equipment CRUD ─────────────────────────────────
  // Read = project member (fail-closed 404); write = project.manage (403).
  // Equipment is scoped to its owning project's internal id, so an equipment id
  // from another project resolves to 404.
  router.get(
    "/projects/:projectId/equipment",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "List a project's equipment",
      responses: { 200: okJson(z.array(equipmentViewSchema)), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const projectId = await requireProjectRead(c, c.req.valid("param").projectId);
      return c.json({ success: true, data: await listEquipment(c.get("db"), projectId) });
    },
  );

  router.post(
    "/projects/:projectId/equipment",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Create a project's equipment item",
      responses: { 201: okJson(equipmentViewSchema, "Created"), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", createEquipmentSchema, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const projectId = await requireProjectManage(c, c.req.valid("param").projectId);
      const created = await createEquipment(c.get("db"), projectId, c.req.valid("json"));
      return c.json({ success: true, data: created }, 201);
    },
  );

  router.get(
    "/projects/:projectId/equipment/:equipmentId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Get a project's equipment item",
      responses: { 200: okJson(equipmentViewSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), equipmentId: z.string() }), onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, equipmentId } = c.req.valid("param");
      const projectId = await requireProjectRead(c, shortId);
      const view = await getEquipment(c.get("db"), projectId, equipmentId);
      if (!view)
        throw new NotFoundError("Equipment", equipmentId);
      return c.json({ success: true, data: view });
    },
  );

  router.patch(
    "/projects/:projectId/equipment/:equipmentId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Update a project's equipment item",
      responses: { 200: okJson(equipmentViewSchema), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), equipmentId: z.string() }), onValidationFailure),
    validator("json", updateEquipmentSchema, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, equipmentId } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      const updated = await updateEquipment(c.get("db"), projectId, equipmentId, c.req.valid("json"));
      if (!updated)
        throw new NotFoundError("Equipment", equipmentId);
      return c.json({ success: true, data: updated });
    },
  );

  router.delete(
    "/projects/:projectId/equipment/:equipmentId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Delete a project's equipment item",
      responses: { 200: okJson(z.null()), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), equipmentId: z.string() }), onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, equipmentId } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      if (!await deleteEquipment(c.get("db"), projectId, equipmentId))
        throw new NotFoundError("Equipment", equipmentId);
      return c.json({ success: true, data: null });
    },
  );

  // ─── `equipment` section: per-project equipment categories ───────────────
  // Each project owns its own category set (seeded from the global template
  // when the section is provisioned). Categories are scoped to their owning
  // project's internal id, so a category id from another project resolves to
  // 404 and one project cannot touch another's categories.
  router.get(
    "/projects/:projectId/equipment-categories",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "List a project's equipment categories",
      responses: { 200: okJson(z.array(equipmentCategoryViewSchema)), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const projectId = await requireProjectRead(c, c.req.valid("param").projectId);
      return c.json({ success: true, data: (await listProjectEquipmentCategories(c.get("db"), projectId)).map(composeProjectEquipmentCategory) });
    },
  );

  router.post(
    "/projects/:projectId/equipment-categories",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Create a project's equipment category",
      responses: { 201: okJson(equipmentCategoryViewSchema, "Created"), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", createEquipmentCategorySchema, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const projectId = await requireProjectManage(c, c.req.valid("param").projectId);
      const category = await createProjectEquipmentCategory(c.get("db"), projectId, c.req.valid("json"));
      return c.json({ success: true, data: composeProjectEquipmentCategory(category) }, 201);
    },
  );

  router.get(
    "/projects/:projectId/equipment-categories/:categoryId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Get a project's equipment category",
      responses: { 200: okJson(equipmentCategoryViewSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), categoryId: z.string() }), onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, categoryId } = c.req.valid("param");
      const projectId = await requireProjectRead(c, shortId);
      const category = await resolveProjectEquipmentCategory(c.get("db"), projectId, categoryId);
      if (!category)
        throw new NotFoundError("Equipment category", categoryId);
      return c.json({ success: true, data: composeProjectEquipmentCategory(category) });
    },
  );

  router.patch(
    "/projects/:projectId/equipment-categories/:categoryId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Update a project's equipment category",
      responses: { 200: okJson(equipmentCategoryViewSchema), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), categoryId: z.string() }), onValidationFailure),
    validator("json", updateEquipmentCategorySchema, onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, categoryId } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      const category = await updateProjectEquipmentCategory(c.get("db"), projectId, categoryId, c.req.valid("json"));
      if (!category)
        throw new NotFoundError("Equipment category", categoryId);
      return c.json({ success: true, data: composeProjectEquipmentCategory(category) });
    },
  );

  router.delete(
    "/projects/:projectId/equipment-categories/:categoryId",
    describeRoute({
      tags: ["ship-equipment"],
      summary: "Delete a project's equipment category",
      responses: { 200: okJson(z.null()), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), categoryId: z.string() }), onValidationFailure),
    requireSection("equipment"),
    async (c) => {
      const { projectId: shortId, categoryId } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      if (!await deleteProjectEquipmentCategory(c.get("db"), projectId, categoryId))
        throw new NotFoundError("Equipment category", categoryId);
      return c.json({ success: true, data: null });
    },
  );

  // ─── `worklist` section ──────────────────────────────────────────────────
  // Read = project member (404 fail-closed); write = project.manage (403).
  // These return ONLY this project's worklists (never global knowledge-base
  // rows), which stay admin-managed under `/worklists`.
  router.get(
    "/projects/:projectId/worklists",
    describeRoute({
      tags: ["worklists"],
      summary: "List a project's worklists",
      responses: { 200: okJson(z.array(worklistViewSchema)), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("query", z.object({ tagId: z.union([z.string(), z.array(z.string())]).optional() }), onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const projectId = await requireProjectRead(c, c.req.valid("param").projectId);
      // Repeated `tagId=` query params combine with OR semantics (any-of); a
      // single value arrives as a scalar, so normalise both to an array.
      const { tagId } = c.req.valid("query");
      const tagIds = tagId === undefined ? undefined : Array.isArray(tagId) ? tagId : [tagId];
      return c.json({ success: true, data: await listProjectWorklists(c.get("db"), projectId, tagIds) });
    },
  );

  // The worklists this project may reference when creating a work order: its
  // own worklists plus the global knowledge base. Lives with the `worklist`
  // section that owns the data — the issue module keeps only reference
  // *creation* (PLAN-108 §5).
  router.get(
    "/projects/:projectId/referenceable-worklists",
    describeRoute({
      tags: ["worklists"],
      summary: "List worklists a project may reference",
      responses: { 200: okJson(referenceableWorklistsSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const projectId = await requireProjectRead(c, c.req.valid("param").projectId);
      return c.json({ success: true, data: await listReferenceableWorklists(c.get("db"), projectId) });
    },
  );

  router.post(
    "/projects/:projectId/worklists",
    describeRoute({
      tags: ["worklists"],
      summary: "Create a project's worklist",
      responses: { 201: okJson(worklistViewSchema, "Created"), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", projectIdParam, onValidationFailure),
    validator("json", createProjectWorklistSchema, onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const projectId = await requireProjectManage(c, c.req.valid("param").projectId);
      const body = c.req.valid("json");
      const result = await createProjectWorklist(c.get("db"), projectId, body);
      if (result.status === "global_not_found")
        throw new NotFoundError("Worklist", body.fromGlobalId);
      return c.json({ success: true, data: result.worklist }, 201);
    },
  );

  router.get(
    "/projects/:projectId/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Get a project's worklist",
      responses: { 200: okJson(worklistViewSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), id: z.string() }), onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const { projectId: shortId, id } = c.req.valid("param");
      const projectId = await requireProjectRead(c, shortId);
      const wl = await getProjectWorklist(c.get("db"), projectId, id);
      if (!wl)
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: wl });
    },
  );

  router.patch(
    "/projects/:projectId/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Update a project's worklist",
      responses: { 200: okJson(worklistViewSchema), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), id: z.string() }), onValidationFailure),
    validator("json", updateWorklistSchema, onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const { projectId: shortId, id } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      const updated = await updateProjectWorklist(c.get("db"), projectId, id, c.req.valid("json"));
      if (!updated)
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: updated });
    },
  );

  router.delete(
    "/projects/:projectId/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Delete a project's worklist",
      responses: { 200: okJson(z.null()), 403: { description: "Forbidden", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ projectId: z.string(), id: z.string() }), onValidationFailure),
    requireSection("worklist"),
    async (c) => {
      const { projectId: shortId, id } = c.req.valid("param");
      const projectId = await requireProjectManage(c, shortId);
      if (!await deleteProjectWorklist(c.get("db"), projectId, id))
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
