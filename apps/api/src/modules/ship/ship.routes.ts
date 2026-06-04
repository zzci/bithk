import type { Context } from "hono";
import type { ShipRow } from "./ship.service";
import type { ProtectedEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "@/modules/audit/audit.service";
import { getClientIp } from "@/shared/lib/client-ip";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { parsePageQuery } from "@/shared/lib/pagination";
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
  bindProject,
  composeShipWithBase,
  createShip,
  getShipByShortId,
  listShipProjects,
  listShips,
  removeShipCover,
  setShipCover,
  softDeleteShip,
  unbindProject,
  updateShip,
  userCanManageShip,
  userCanReadShip,
} from "./ship.service";
import {
  composeShipEquipmentCategory,
  createShipEquipmentCategory,
  deleteShipEquipmentCategory,
  listShipEquipmentCategories,
  resolveShipEquipmentCategory,
  updateShipEquipmentCategory,
} from "./ship.ship-equipment-category.service";
import {
  createShipWorklist,
  createShipWorklistSchema,
  deleteShipWorklist,
  getShipWorklist,
  listShipWorklists,
  updateShipWorklist,
  updateWorklistSchema,
} from "./ship.worklist.service";

const shipCoreShape = {
  // Per-tag length + array-size caps (mirrors the project tag bound) so
  // unbounded tag count/length cannot flow into syncResourceTagsTx.
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  model: z.string().max(255).nullable().optional(),
  builder: z.string().max(255).nullable().optional(),
  buildYear: z.number().int().min(1800).max(2200).nullable().optional(),
  lengthOverall: z.number().nonnegative().nullable().optional(),
  beam: z.number().nonnegative().nullable().optional(),
  draft: z.number().nonnegative().nullable().optional(),
  airDraft: z.number().nonnegative().nullable().optional(),
  grossTonnage: z.number().nonnegative().nullable().optional(),
  imoNumber: z.string().max(50).nullable().optional(),
  mmsi: z.string().max(50).nullable().optional(),
  callSign: z.string().max(50).nullable().optional(),
  flagState: z.string().max(100).nullable().optional(),
  registryPort: z.string().max(100).nullable().optional(),
  ownerName: z.string().max(255).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
};

const createShipSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255),
  status: z.enum(SHIP_STATUSES).optional(),
  ...shipCoreShape,
});

const updateShipSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  status: z.enum(SHIP_STATUSES).optional(),
  ...shipCoreShape,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const listSchema = z.object({
  status: z.enum(SHIP_STATUSES).optional(),
  // Repeated `tagId=` query params combine with OR semantics (any-of).
  tagIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  q: z.string().max(200).optional(),
});

const bindProjectSchema = z.object({ projectShortId: z.string().min(1) });

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

function actorId(c: Context<ProtectedEnv>): string {
  return c.get("user").id;
}

function auditMeta(c: Context<ProtectedEnv>) {
  return {
    ip: getClientIp(c),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

/**
 * Load the ship from its short id and assert the actor may read it (admin or a
 * member of the base project). Fail-closed: an unknown ship and a ship the
 * caller cannot read both surface as 404, so membership is never leaked.
 */
async function requireShipRead(c: Context<ProtectedEnv>, shortId: string): Promise<{ ship: ShipRow }> {
  const db = c.get("db");
  const user = c.get("user");
  const ship = await getShipByShortId(db, shortId);
  if (!ship)
    throw new NotFoundError("Ship", shortId);
  if (await userCanReadShip(db, ship, user.id, user.role === "admin"))
    return { ship };
  throw new NotFoundError("Ship", shortId);
}

/** Read access first (404 fail-closed), then `project.manage` on the base project (else 403). */
async function requireShipManage(c: Context<ProtectedEnv>, shortId: string): Promise<{ ship: ShipRow }> {
  const { ship } = await requireShipRead(c, shortId);
  const db = c.get("db");
  const user = c.get("user");
  if (await userCanManageShip(db, ship, user.id, user.role === "admin"))
    return { ship };
  throw new ForbiddenError("Capability 'project.manage' required");
}

export function shipRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  // ─── Global equipment-category template (bilingual vocabulary, admin only) ───
  // The admin-maintained template set copied per-ship into
  // `ship_equipment_categories` on ship create (copy-on-create). Every verb is
  // admin-only and mutations are audited, matching the global worklist
  // knowledge-base routes. Mirrors the global procurement-categories pattern.
  router.get("/global-equipment-categories", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: (await listGlobalEquipmentCategories(db)).map(composeGlobalEquipmentCategory) });
  });

  router.post("/global-equipment-categories", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = createEquipmentCategorySchema.parse(await c.req.json());
    const category = await createGlobalEquipmentCategory(db, body);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "global_equipment_category.created",
      resourceType: "global_equipment_category",
      resourceId: category.id,
      resourceName: category.nameZh,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeGlobalEquipmentCategory(category) }, 201);
  });

  router.get("/global-equipment-categories/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const category = await resolveGlobalEquipmentCategory(db, id);
    if (!category)
      throw new NotFoundError("Equipment category", id);
    return c.json({ success: true, data: composeGlobalEquipmentCategory(category) });
  });

  router.patch("/global-equipment-categories/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const body = updateEquipmentCategorySchema.parse(await c.req.json());
    const category = await updateGlobalEquipmentCategory(db, id, body);
    if (!category)
      throw new NotFoundError("Equipment category", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "global_equipment_category.updated",
      resourceType: "global_equipment_category",
      resourceId: category.id,
      resourceName: category.nameZh,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeGlobalEquipmentCategory(category) });
  });

  router.delete("/global-equipment-categories/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const category = await resolveGlobalEquipmentCategory(db, id);
    if (!category || !await deleteGlobalEquipmentCategory(db, id))
      throw new NotFoundError("Equipment category", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "global_equipment_category.deleted",
      resourceType: "global_equipment_category",
      resourceId: category.id,
      resourceName: category.nameZh,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  // ─── Global equipment-manufacturer vocabulary (admin only) ───────────────
  // A standalone admin-maintained brand list referenced directly by
  // `ship_equipment.manufacturer_id` (no per-ship copy). Every verb is
  // admin-only and mutations are audited, matching the global equipment-category
  // routes above.
  router.get("/global-equipment-manufacturers", adminRequired, async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: (await listGlobalEquipmentManufacturers(db)).map(composeGlobalEquipmentManufacturer) });
  });

  router.post("/global-equipment-manufacturers", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = createManufacturerSchema.parse(await c.req.json());
    const manufacturer = await createGlobalEquipmentManufacturer(db, body);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "equipment_manufacturer.created",
      resourceType: "equipment_manufacturer",
      resourceId: manufacturer.id,
      resourceName: manufacturer.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) }, 201);
  });

  router.get("/global-equipment-manufacturers/:id", adminRequired, async (c) => {
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const manufacturer = await resolveGlobalEquipmentManufacturer(db, id);
    if (!manufacturer)
      throw new NotFoundError("Equipment manufacturer", id);
    return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) });
  });

  router.patch("/global-equipment-manufacturers/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const body = updateManufacturerSchema.parse(await c.req.json());
    const manufacturer = await updateGlobalEquipmentManufacturer(db, id, body);
    if (!manufacturer)
      throw new NotFoundError("Equipment manufacturer", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "equipment_manufacturer.updated",
      resourceType: "equipment_manufacturer",
      resourceId: manufacturer.id,
      resourceName: manufacturer.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: composeGlobalEquipmentManufacturer(manufacturer) });
  });

  router.delete("/global-equipment-manufacturers/:id", adminRequired, async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = idSchema.parse(c.req.param("id"));
    const manufacturer = await resolveGlobalEquipmentManufacturer(db, id);
    if (!manufacturer || !await deleteGlobalEquipmentManufacturer(db, id))
      throw new NotFoundError("Equipment manufacturer", id);
    await audit(db, c.get("logger"), {
      actorId: user.id,
      actorName: user.name,
      action: "equipment_manufacturer.deleted",
      resourceType: "equipment_manufacturer",
      resourceId: manufacturer.id,
      resourceName: manufacturer.name,
      ...auditMeta(c),
      result: "success",
    });
    return c.json({ success: true, data: null });
  });

  // GET /ships — list. Admins see all; others see only ships whose base
  // project they belong to.
  router.get("/ships", async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const rawTagIds = c.req.queries("tagId") ?? [];
    const query = listSchema.parse({
      status: c.req.query("status"),
      tagIds: rawTagIds.length > 0 ? rawTagIds : undefined,
      q: c.req.query("q") || undefined,
    });
    const { page, limit } = parsePageQuery(c, { limit: 20 });
    const result = await listShips(db, {
      ...query,
      page,
      limit,
      memberUserId: user.role === "admin" ? undefined : user.id,
    });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page, limit },
    });
  });

  // POST /ships — create (admin only); also creates the base project.
  router.post("/ships", adminRequired, async (c) => {
    const db = c.get("db");
    const body = createShipSchema.parse(await c.req.json());
    const ship = await createShip(db, { ...body, creatorId: actorId(c) });
    return c.json({ success: true, data: await composeShipWithBase(db, ship) }, 201);
  });

  // GET /ships/:shortId — detail (base-project member).
  router.get("/ships/:shortId", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: await composeShipWithBase(db, ship) });
  });

  // PATCH /ships/:shortId — update (project.manage on the base project).
  router.patch("/ships/:shortId", async (c) => {
    const shortId = c.req.param("shortId");
    await requireShipManage(c, shortId);
    const db = c.get("db");
    const body = updateShipSchema.parse(await c.req.json());
    const updated = await updateShip(db, shortId, body);
    if (!updated)
      throw new NotFoundError("Ship", shortId);
    return c.json({ success: true, data: await composeShipWithBase(db, updated) });
  });

  // DELETE /ships/:shortId — soft delete (admin only).
  router.delete("/ships/:shortId", adminRequired, async (c) => {
    const db = c.get("db");
    const shortId = c.req.param("shortId");
    if (!await getShipByShortId(db, shortId))
      throw new NotFoundError("Ship", shortId);
    await softDeleteShip(db, c.get("config"), shortId);
    return c.json({ success: true, data: null });
  });

  // POST /ships/:shortId/cover-image — set / replace the cover (manage).
  router.post("/ships/:shortId/cover-image", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File))
      throw new AppError("No file provided", 400, "VALIDATION_ERROR");
    if (!file.type.startsWith("image/"))
      throw new AppError("Cover image must be an image file", 400, "INVALID_MIMETYPE");

    const updated = await setShipCover(db, c.get("config"), ship.id, file, actorId(c));
    if (!updated)
      throw new NotFoundError("Ship", c.req.param("shortId"));
    return c.json({ success: true, data: await composeShipWithBase(db, updated) });
  });

  // DELETE /ships/:shortId/cover-image — remove the cover (manage).
  router.delete("/ships/:shortId/cover-image", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const updated = await removeShipCover(db, c.get("config"), ship.id);
    if (!updated)
      throw new NotFoundError("Ship", c.req.param("shortId"));
    return c.json({ success: true, data: await composeShipWithBase(db, updated) });
  });

  // ─── Ship ↔ project binding ──────────────────────────────────────────
  router.get("/ships/:shortId/projects", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: await listShipProjects(db, ship.id, ship.baseProjectId) });
  });

  router.post("/ships/:shortId/projects", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const body = bindProjectSchema.parse(await c.req.json());
    const result = await bindProject(db, ship.id, body.projectShortId);
    if (result === "not_found")
      throw new NotFoundError("Project", body.projectShortId);
    if (result === "is_base")
      throw new ValidationError("Project is already a ship's base project", { projectShortId: "Cannot bind a base project" });
    if (result === "bound_elsewhere")
      throw new ValidationError("Project is already bound to another ship", { projectShortId: "Already bound to another ship" });
    return c.json({ success: true, data: await listShipProjects(db, ship.id, ship.baseProjectId) });
  });

  router.delete("/ships/:shortId/projects/:projectShortId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const result = await unbindProject(db, ship.id, ship.baseProjectId, c.req.param("projectShortId"));
    if (result === "not_found")
      throw new NotFoundError("Bound project", c.req.param("projectShortId"));
    if (result === "is_base")
      throw new ForbiddenError("The base project cannot be unbound");
    return c.json({ success: true, data: null });
  });

  // ─── Ship equipment CRUD ─────────────────────────────────────────────
  // Sub-paths of /ships/:shortId. Read = base-project member (fail-closed
  // 404 via requireShipRead); write = project.manage (403 via
  // requireShipManage). Equipment is scoped to its parent ship's internal id,
  // so an equipment id from another ship resolves to 404.
  router.get("/ships/:shortId/equipment", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: await listEquipment(db, ship.id) });
  });

  router.post("/ships/:shortId/equipment", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const body = createEquipmentSchema.parse(await c.req.json());
    const created = await createEquipment(db, ship.id, body);
    return c.json({ success: true, data: created }, 201);
  });

  router.get("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    const view = await getEquipment(db, ship.id, equipmentId);
    if (!view)
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: view });
  });

  router.patch("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    const body = updateEquipmentSchema.parse(await c.req.json());
    const updated = await updateEquipment(db, ship.id, equipmentId, body);
    if (!updated)
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: updated });
  });

  router.delete("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    if (!await deleteEquipment(db, ship.id, equipmentId))
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: null });
  });

  // ─── Per-ship equipment categories ───────────────────────────────────────
  // Each ship owns its own category set (seeded from the global template on
  // create). Read = base-project member (404 fail-closed via requireShipRead);
  // write = project.manage (403 via requireShipManage). Categories are scoped to
  // their parent ship's internal id, so a category id from another ship resolves
  // to 404 and one ship cannot touch another's categories.
  router.get("/ships/:shortId/equipment-categories", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: (await listShipEquipmentCategories(db, ship.id)).map(composeShipEquipmentCategory) });
  });

  router.post("/ships/:shortId/equipment-categories", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const body = createEquipmentCategorySchema.parse(await c.req.json());
    const category = await createShipEquipmentCategory(db, ship.id, body);
    return c.json({ success: true, data: composeShipEquipmentCategory(category) }, 201);
  });

  router.get("/ships/:shortId/equipment-categories/:categoryId", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    const categoryId = c.req.param("categoryId");
    const category = await resolveShipEquipmentCategory(db, ship.id, categoryId);
    if (!category)
      throw new NotFoundError("Equipment category", categoryId);
    return c.json({ success: true, data: composeShipEquipmentCategory(category) });
  });

  router.patch("/ships/:shortId/equipment-categories/:categoryId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const categoryId = c.req.param("categoryId");
    const body = updateEquipmentCategorySchema.parse(await c.req.json());
    const category = await updateShipEquipmentCategory(db, ship.id, categoryId, body);
    if (!category)
      throw new NotFoundError("Equipment category", categoryId);
    return c.json({ success: true, data: composeShipEquipmentCategory(category) });
  });

  router.delete("/ships/:shortId/equipment-categories/:categoryId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const categoryId = c.req.param("categoryId");
    if (!await deleteShipEquipmentCategory(db, ship.id, categoryId))
      throw new NotFoundError("Equipment category", categoryId);
    return c.json({ success: true, data: null });
  });
  // ─── Ship-level worklists ────────────────────────────────────────────────
  // Read = base-project member (404 fail-closed); write = project.manage (403).
  // These return ONLY this ship's worklists (never global knowledge-base rows).
  router.get("/ships/:shortId/worklists", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    // Repeated `tagId=` query params combine with OR semantics (any-of).
    const rawTagIds = c.req.queries("tagId") ?? [];
    return c.json({ success: true, data: await listShipWorklists(db, ship.id, rawTagIds.length > 0 ? rawTagIds : undefined) });
  });

  router.post("/ships/:shortId/worklists", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const body = createShipWorklistSchema.parse(await c.req.json());
    const result = await createShipWorklist(db, ship.id, body);
    if (result.status === "global_not_found")
      throw new NotFoundError("Worklist", body.fromGlobalId);
    return c.json({ success: true, data: result.worklist }, 201);
  });

  router.get("/ships/:shortId/worklists/:id", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    const wl = await getShipWorklist(db, ship.id, id);
    if (!wl)
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: wl });
  });

  router.patch("/ships/:shortId/worklists/:id", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateWorklistSchema.parse(await c.req.json());
    const updated = await updateShipWorklist(db, ship.id, id, body);
    if (!updated)
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: updated });
  });

  router.delete("/ships/:shortId/worklists/:id", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    if (!await deleteShipWorklist(db, ship.id, id))
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: null });
  });
  // ─── end worklists ─────────────────────────────────────────────────────────

  return router;
}
