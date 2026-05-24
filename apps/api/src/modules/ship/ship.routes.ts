import type { Context } from "hono";
import type { ShipRow } from "./ship.service";
import type { AppEnv } from "@/shared/lib/types";
import { Hono } from "hono";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { SHIP_LIFECYCLE_STAGES, SHIP_STATUSES } from "./schema";
import {
  createShipTemplate,
  createShipTemplateSchema,
  deleteShipTemplate,
  getShipTemplate,
  listShipTemplates,
  updateShipTemplate,
  updateTemplateSchema,
} from "./ship.maintenance-template.service";
import {
  bindProject,
  composeShipWithBase,
  createShip,
  getShipByShortId,
  listShipProjects,
  listShips,
  softDeleteShip,
  unbindProject,
  updateShip,
  userCanManageShip,
  userCanReadShip,
} from "./ship.service";

const shipCoreShape = {
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
  lifecycleStage: z.enum(SHIP_LIFECYCLE_STAGES).optional(),
  ...shipCoreShape,
});

const updateShipSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
  status: z.enum(SHIP_STATUSES).optional(),
  lifecycleStage: z.enum(SHIP_LIFECYCLE_STAGES).optional(),
  ...shipCoreShape,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

const listSchema = z.object({
  status: z.enum(SHIP_STATUSES).optional(),
  lifecycleStage: z.enum(SHIP_LIFECYCLE_STAGES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const bindProjectSchema = z.object({ projectShortId: z.string().min(1) });

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
      lifecycleStage: c.req.query("lifecycleStage"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    });
    const result = await listShips(db, {
      ...query,
      q: c.req.query("q") || undefined,
      memberUserId: user.role === "admin" ? undefined : user.id,
    });
    return c.json({
      success: true,
      data: result.data,
      meta: { total: result.total, page: query.page ?? 1, limit: query.limit ?? 20 },
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
    await softDeleteShip(db, shortId);
    return c.json({ success: true, data: null });
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

  // ─── T3: ship-level maintenance templates ───────────────────────────────
  // Read = base-project member (404 fail-closed); write = project.manage (403).
  // These return ONLY this ship's templates (never global knowledge-base rows).
  router.get("/ships/:shortId/maintenance-templates", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    return c.json({ success: true, data: await listShipTemplates(db, ship.id) });
  });

  router.post("/ships/:shortId/maintenance-templates", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const body = createShipTemplateSchema.parse(await c.req.json());
    const result = await createShipTemplate(db, ship.id, body);
    if (result.status === "global_not_found")
      throw new NotFoundError("Maintenance template", body.fromGlobalId);
    return c.json({ success: true, data: result.template }, 201);
  });

  router.get("/ships/:shortId/maintenance-templates/:id", async (c) => {
    const { ship } = await requireShipRead(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    const tpl = await getShipTemplate(db, ship.id, id);
    if (!tpl)
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: tpl });
  });

  router.patch("/ships/:shortId/maintenance-templates/:id", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateTemplateSchema.parse(await c.req.json());
    const updated = await updateShipTemplate(db, ship.id, id, body);
    if (!updated)
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: updated });
  });

  router.delete("/ships/:shortId/maintenance-templates/:id", async (c) => {
    const { ship } = await requireShipManage(c, c.req.param("shortId"));
    const db = c.get("db");
    const id = c.req.param("id");
    if (!await deleteShipTemplate(db, ship.id, id))
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: null });
  });
  // ─── end T3 ──────────────────────────────────────────────────────────────

  return router;
}
