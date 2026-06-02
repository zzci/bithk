import type { Context } from "hono";
import type { ShipRow } from "./ship.service";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { parsePageQuery } from "@/shared/lib/pagination";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { EQUIPMENT_STATUSES, SHIP_STATUSES } from "./schema";
import {
  composeEquipment,
  createEquipment,
  deleteEquipment,
  getEquipment,
  listEquipment,
  updateEquipment,
} from "./ship.equipment.service";
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
  tagId: z.string().max(100).optional(),
  q: z.string().max(200).optional(),
});

const bindProjectSchema = z.object({ projectShortId: z.string().min(1) });

const equipmentCoreShape = {
  category: z.string().max(255).nullable().optional(),
  manufacturer: z.string().max(255).nullable().optional(),
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

function actorId(c: Context<AppEnv>): string {
  return c.get("user")!.id;
}

/**
 * Load the ship from its short id and assert the actor may read it (admin or a
 * member of the base project). Fail-closed: an unknown ship and a ship the
 * caller cannot read both surface as 404, so membership is never leaked.
 */
async function requireShipRead(c: Context<AppEnv>, shortId: string): Promise<{ ship: ShipRow }> {
  const db = c.get("db");
  const user = c.get("user")!;
  const ship = await getShipByShortId(db, shortId);
  if (!ship)
    throw new NotFoundError("Ship", shortId);
  if (await userCanReadShip(db, ship, user.id, user.role === "admin"))
    return { ship };
  throw new NotFoundError("Ship", shortId);
}

/** Read access first (404 fail-closed), then `project.manage` on the base project (else 403). */
async function requireShipManage(c: Context<AppEnv>, shortId: string): Promise<{ ship: ShipRow }> {
  const { ship } = await requireShipRead(c, shortId);
  const db = c.get("db");
  const user = c.get("user")!;
  if (await userCanManageShip(db, ship, user.id, user.role === "admin"))
    return { ship };
  throw new ForbiddenError("Capability 'project.manage' required");
}

export function shipRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);

  // GET /ships — list. Admins see all; others see only ships whose base
  // project they belong to.
  router.get("/ships", async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const query = listSchema.parse({
      status: c.req.query("status"),
      tagId: c.req.query("tagId"),
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
    return c.json({ success: true, data: composeEquipment(created) }, 201);
  });

  router.get("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    const row = await getEquipment(db, ship.id, equipmentId);
    if (!row)
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: composeEquipment(row) });
  });

  router.patch("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    const body = updateEquipmentSchema.parse(await c.req.json());
    const updated = await updateEquipment(db, ship.id, equipmentId, body);
    if (!updated)
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: composeEquipment(updated) });
  });

  router.delete("/ships/:shortId/equipment/:equipmentId", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const equipmentId = c.req.param("equipmentId");
    if (!await deleteEquipment(db, ship.id, equipmentId))
      throw new NotFoundError("Equipment", equipmentId);
    return c.json({ success: true, data: null });
  });
  // ─── Ship-level worklists ────────────────────────────────────────────────
  // Read = base-project member (404 fail-closed); write = project.manage (403).
  // These return ONLY this ship's worklists (never global knowledge-base rows).
  router.get("/ships/:shortId/worklists", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: await listShipWorklists(db, ship.id) });
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
