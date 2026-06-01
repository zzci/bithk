import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { maintenanceTemplates } from "./schema";

export type MaintenanceTemplateRow = typeof maintenanceTemplates.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `shipId` is an internal ULID (or NULL for the global knowledge base) and is
// never exposed: global templates are reached through admin-only routes and
// ship-level templates through their owning ship's nested routes, so the
// owner is always implied by the path.
export interface MaintenanceTemplateView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeTemplate(row: MaintenanceTemplateRow): MaintenanceTemplateView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    checklist: row.checklist,
    precautions: row.precautions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TemplateInput {
  readonly name: string;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

export interface UpdateTemplateInput {
  readonly name?: string | undefined;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

const UPDATABLE_KEYS = ["name", "category", "checklist", "precautions"] as const;

// ─── Global knowledge base (ship_id NULL) ──────────────────────────────────

export async function listGlobalTemplates(db: AppDatabase): Promise<readonly MaintenanceTemplateView[]> {
  const rows = await db.select().from(maintenanceTemplates).where(isNull(maintenanceTemplates.shipId)).orderBy(desc(maintenanceTemplates.createdAt)).all();
  return rows.map(composeTemplate);
}

export async function createGlobalTemplate(db: AppDatabase, input: TemplateInput): Promise<MaintenanceTemplateView> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(maintenanceTemplates).values({
    id,
    shipId: null,
    name: input.name,
    category: input.category ?? null,
    checklist: input.checklist ?? null,
    precautions: input.precautions ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return composeTemplate((await db.select().from(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).get())!);
}

/** Fetch a global template (ship_id NULL); ship-level rows are never returned. */
export async function getGlobalTemplate(db: AppDatabase, id: string): Promise<MaintenanceTemplateView | undefined> {
  const row = await db.select().from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), isNull(maintenanceTemplates.shipId))).get();
  return row ? composeTemplate(row) : undefined;
}

export async function updateGlobalTemplate(db: AppDatabase, id: string, input: UpdateTemplateInput): Promise<MaintenanceTemplateView | undefined> {
  const existing = await db.select().from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), isNull(maintenanceTemplates.shipId))).get();
  if (!existing)
    return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  await db.update(maintenanceTemplates).set(patch).where(eq(maintenanceTemplates.id, id)).run();
  return composeTemplate((await db.select().from(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).get())!);
}

export async function deleteGlobalTemplate(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await db.select({ id: maintenanceTemplates.id }).from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), isNull(maintenanceTemplates.shipId))).get();
  if (!existing)
    return false;
  await db.delete(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).run();
  return true;
}

// ─── Ship-level templates (ship_id set) ─────────────────────────────────────

/** List ONLY the given ship's templates; global (ship_id NULL) rows are excluded. */
export async function listShipTemplates(db: AppDatabase, shipInternalId: string): Promise<readonly MaintenanceTemplateView[]> {
  const rows = await db.select().from(maintenanceTemplates).where(eq(maintenanceTemplates.shipId, shipInternalId)).orderBy(desc(maintenanceTemplates.createdAt)).all();
  return rows.map(composeTemplate);
}

// `name` is optional here (unlike the global `TemplateInput`): when
// `fromGlobalId` is set the name is copied from the source. The route schema
// guarantees a name is present on the from-scratch path.
export interface CreateShipTemplateInput {
  readonly name?: string | undefined;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
  // When set, copy name/category/checklist/precautions from this global
  // template once. The copy is independent thereafter.
  readonly fromGlobalId?: string | undefined;
}

export type CreateShipTemplateResult
  = | { readonly status: "ok"; readonly template: MaintenanceTemplateView }
    | { readonly status: "global_not_found" };

/**
 * Create a ship-level template. Either from scratch (body fields) or, when
 * `fromGlobalId` is set, as a ONE-TIME copy of a global knowledge-base entry:
 * the global row's name/category/checklist/precautions are snapshotted into a
 * new independent ship-level row, so later edits to the global do not affect
 * this copy.
 */
export async function createShipTemplate(db: AppDatabase, shipInternalId: string, input: CreateShipTemplateInput): Promise<CreateShipTemplateResult> {
  const id = nanoid();
  const now = new Date().toISOString();

  let name = input.name ?? "";
  let category = input.category ?? null;
  let checklist = input.checklist ?? null;
  let precautions = input.precautions ?? null;

  if (input.fromGlobalId !== undefined) {
    const source = await getGlobalTemplate(db, input.fromGlobalId);
    if (!source)
      return { status: "global_not_found" };
    name = source.name;
    category = source.category;
    checklist = source.checklist;
    precautions = source.precautions;
  }

  await db.insert(maintenanceTemplates).values({
    id,
    shipId: shipInternalId,
    name,
    category,
    checklist,
    precautions,
    createdAt: now,
    updatedAt: now,
  }).run();
  return { status: "ok", template: composeTemplate((await db.select().from(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).get())!) };
}

export async function getShipTemplate(db: AppDatabase, shipInternalId: string, id: string): Promise<MaintenanceTemplateView | undefined> {
  const row = await db.select().from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), eq(maintenanceTemplates.shipId, shipInternalId))).get();
  return row ? composeTemplate(row) : undefined;
}

export async function updateShipTemplate(db: AppDatabase, shipInternalId: string, id: string, input: UpdateTemplateInput): Promise<MaintenanceTemplateView | undefined> {
  const existing = await db.select().from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), eq(maintenanceTemplates.shipId, shipInternalId))).get();
  if (!existing)
    return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  await db.update(maintenanceTemplates).set(patch).where(eq(maintenanceTemplates.id, id)).run();
  return composeTemplate((await db.select().from(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).get())!);
}

export async function deleteShipTemplate(db: AppDatabase, shipInternalId: string, id: string): Promise<boolean> {
  const existing = await db.select({ id: maintenanceTemplates.id }).from(maintenanceTemplates).where(and(eq(maintenanceTemplates.id, id), eq(maintenanceTemplates.shipId, shipInternalId))).get();
  if (!existing)
    return false;
  await db.delete(maintenanceTemplates).where(eq(maintenanceTemplates.id, id)).run();
  return true;
}

// ─── Route schemas (Hono routers in ship.routes.ts import these) ────────────

// B7: short label fields share a 255-char cap across the ship module
// (matches `category` in the equipment schema and the ship name/model caps);
// `checklist`/`precautions` are long free-form text and keep the 10000 cap.
const templateFields = {
  category: z.string().max(255).nullable().optional(),
  checklist: z.string().max(10000).nullable().optional(),
  precautions: z.string().max(10000).nullable().optional(),
};

export const createGlobalTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  ...templateFields,
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  ...templateFields,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

export const createShipTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fromGlobalId: z.string().min(1).optional(),
  ...templateFields,
}).refine(
  v => v.fromGlobalId !== undefined || v.name !== undefined,
  { message: "name is required when fromGlobalId is not provided" },
).refine(
  // B5 / Design Constraint 3: `fromGlobalId` snapshots the global row's content
  // wholesale, so mixing it with explicit content fields is contradictory.
  // Reject it here (one or the other); the global snapshot wins by definition.
  v => v.fromGlobalId === undefined
    || (v.name === undefined && v.category === undefined && v.checklist === undefined && v.precautions === undefined),
  { message: "Cannot combine fromGlobalId with name/category/checklist/precautions; the global template is copied as-is" },
);

// ─── Global knowledge-base router (admin only; mounted in protected.ts) ──────

export function maintenanceTemplateRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);
  router.use("*", adminRequired);

  router.get("/maintenance-templates", async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: await listGlobalTemplates(db) });
  });

  router.post("/maintenance-templates", async (c) => {
    const db = c.get("db");
    const body = createGlobalTemplateSchema.parse(await c.req.json());
    return c.json({ success: true, data: await createGlobalTemplate(db, body) }, 201);
  });

  router.get("/maintenance-templates/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const tpl = await getGlobalTemplate(db, id);
    if (!tpl)
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: tpl });
  });

  router.patch("/maintenance-templates/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateTemplateSchema.parse(await c.req.json());
    const updated = await updateGlobalTemplate(db, id, body);
    if (!updated)
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: updated });
  });

  router.delete("/maintenance-templates/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    if (!await deleteGlobalTemplate(db, id))
      throw new NotFoundError("Maintenance template", id);
    return c.json({ success: true, data: null });
  });

  return router;
}
