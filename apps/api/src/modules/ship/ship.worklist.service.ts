import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { worklists } from "./schema";

export type WorklistRow = typeof worklists.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `shipId` is an internal ULID (or NULL for the global knowledge base) and is
// never exposed: global worklists are reached through admin-only routes and
// ship-level worklists through their owning ship's nested routes, so the
// owner is always implied by the path.
export interface WorklistView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function composeWorklist(row: WorklistRow): WorklistView {
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

export interface WorklistInput {
  readonly name: string;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

export interface UpdateWorklistInput {
  readonly name?: string | undefined;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

const UPDATABLE_KEYS = ["name", "category", "checklist", "precautions"] as const;

// ─── Global knowledge base (ship_id NULL) ──────────────────────────────────

export async function listGlobalWorklists(db: AppDatabase): Promise<readonly WorklistView[]> {
  const rows = await db.select().from(worklists).where(isNull(worklists.shipId)).orderBy(desc(worklists.createdAt)).all();
  return rows.map(composeWorklist);
}

export async function createGlobalWorklist(db: AppDatabase, input: WorklistInput): Promise<WorklistView> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(worklists).values({
    id,
    shipId: null,
    name: input.name,
    category: input.category ?? null,
    checklist: input.checklist ?? null,
    precautions: input.precautions ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return composeWorklist((await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

/** Fetch a global worklist (ship_id NULL); ship-level rows are never returned. */
export async function getGlobalWorklist(db: AppDatabase, id: string): Promise<WorklistView | undefined> {
  const row = await db.select().from(worklists).where(and(eq(worklists.id, id), isNull(worklists.shipId))).get();
  return row ? composeWorklist(row) : undefined;
}

export async function updateGlobalWorklist(db: AppDatabase, id: string, input: UpdateWorklistInput): Promise<WorklistView | undefined> {
  const existing = await db.select().from(worklists).where(and(eq(worklists.id, id), isNull(worklists.shipId))).get();
  if (!existing)
    return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  await db.update(worklists).set(patch).where(eq(worklists.id, id)).run();
  return composeWorklist((await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

export async function deleteGlobalWorklist(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await db.select({ id: worklists.id }).from(worklists).where(and(eq(worklists.id, id), isNull(worklists.shipId))).get();
  if (!existing)
    return false;
  await db.delete(worklists).where(eq(worklists.id, id)).run();
  return true;
}

// ─── Ship-level worklists (ship_id set) ─────────────────────────────────────

/** List ONLY the given ship's worklists; global (ship_id NULL) rows are excluded. */
export async function listShipWorklists(db: AppDatabase, shipInternalId: string): Promise<readonly WorklistView[]> {
  const rows = await db.select().from(worklists).where(eq(worklists.shipId, shipInternalId)).orderBy(desc(worklists.createdAt)).all();
  return rows.map(composeWorklist);
}

// `name` is optional here (unlike the global `WorklistInput`): when
// `fromGlobalId` is set the name is copied from the source. The route schema
// guarantees a name is present on the from-scratch path.
export interface CreateShipWorklistInput {
  readonly name?: string | undefined;
  readonly category?: string | null | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
  // When set, copy name/category/checklist/precautions from this global
  // worklist once. The copy is independent thereafter.
  readonly fromGlobalId?: string | undefined;
}

export type CreateShipWorklistResult
  = | { readonly status: "ok"; readonly worklist: WorklistView }
    | { readonly status: "global_not_found" };

/**
 * Create a ship-level worklist. Either from scratch (body fields) or, when
 * `fromGlobalId` is set, as a ONE-TIME copy of a global knowledge-base entry:
 * the global row's name/category/checklist/precautions are snapshotted into a
 * new independent ship-level row, so later edits to the global do not affect
 * this copy.
 */
export async function createShipWorklist(db: AppDatabase, shipInternalId: string, input: CreateShipWorklistInput): Promise<CreateShipWorklistResult> {
  const id = nanoid();
  const now = new Date().toISOString();

  let name = input.name ?? "";
  let category = input.category ?? null;
  let checklist = input.checklist ?? null;
  let precautions = input.precautions ?? null;

  if (input.fromGlobalId !== undefined) {
    const source = await getGlobalWorklist(db, input.fromGlobalId);
    if (!source)
      return { status: "global_not_found" };
    name = source.name;
    category = source.category;
    checklist = source.checklist;
    precautions = source.precautions;
  }

  await db.insert(worklists).values({
    id,
    shipId: shipInternalId,
    name,
    category,
    checklist,
    precautions,
    createdAt: now,
    updatedAt: now,
  }).run();
  return { status: "ok", worklist: composeWorklist((await db.select().from(worklists).where(eq(worklists.id, id)).get())!) };
}

export async function getShipWorklist(db: AppDatabase, shipInternalId: string, id: string): Promise<WorklistView | undefined> {
  const row = await db.select().from(worklists).where(and(eq(worklists.id, id), eq(worklists.shipId, shipInternalId))).get();
  return row ? composeWorklist(row) : undefined;
}

export async function updateShipWorklist(db: AppDatabase, shipInternalId: string, id: string, input: UpdateWorklistInput): Promise<WorklistView | undefined> {
  const existing = await db.select().from(worklists).where(and(eq(worklists.id, id), eq(worklists.shipId, shipInternalId))).get();
  if (!existing)
    return undefined;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  await db.update(worklists).set(patch).where(eq(worklists.id, id)).run();
  return composeWorklist((await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

export async function deleteShipWorklist(db: AppDatabase, shipInternalId: string, id: string): Promise<boolean> {
  const existing = await db.select({ id: worklists.id }).from(worklists).where(and(eq(worklists.id, id), eq(worklists.shipId, shipInternalId))).get();
  if (!existing)
    return false;
  await db.delete(worklists).where(eq(worklists.id, id)).run();
  return true;
}

// ─── Route schemas (Hono routers in ship.routes.ts import these) ────────────

// B7: short label fields share a 255-char cap across the ship module
// (matches `category` in the equipment schema and the ship name/model caps);
// `checklist`/`precautions` are long free-form text and keep the 10000 cap.
const worklistFields = {
  category: z.string().max(255).nullable().optional(),
  checklist: z.string().max(10000).nullable().optional(),
  precautions: z.string().max(10000).nullable().optional(),
};

export const createGlobalWorklistSchema = z.object({
  name: z.string().min(1).max(255),
  ...worklistFields,
});

export const updateWorklistSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  ...worklistFields,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

export const createShipWorklistSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fromGlobalId: z.string().min(1).optional(),
  ...worklistFields,
}).refine(
  v => v.fromGlobalId !== undefined || v.name !== undefined,
  { message: "name is required when fromGlobalId is not provided" },
).refine(
  // B5 / Design Constraint 3: `fromGlobalId` snapshots the global row's content
  // wholesale, so mixing it with explicit content fields is contradictory.
  // Reject it here (one or the other); the global snapshot wins by definition.
  v => v.fromGlobalId === undefined
    || (v.name === undefined && v.category === undefined && v.checklist === undefined && v.precautions === undefined),
  { message: "Cannot combine fromGlobalId with name/category/checklist/precautions; the global worklist is copied as-is" },
);

// ─── Global knowledge-base router (admin only; mounted in protected.ts) ──────

export function worklistRoutes() {
  const router = new Hono<AppEnv>();
  router.use("*", authRequired);
  router.use("*", adminRequired);

  router.get("/worklists", async (c) => {
    const db = c.get("db");
    return c.json({ success: true, data: await listGlobalWorklists(db) });
  });

  router.post("/worklists", async (c) => {
    const db = c.get("db");
    const body = createGlobalWorklistSchema.parse(await c.req.json());
    return c.json({ success: true, data: await createGlobalWorklist(db, body) }, 201);
  });

  router.get("/worklists/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const wl = await getGlobalWorklist(db, id);
    if (!wl)
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: wl });
  });

  router.patch("/worklists/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const body = updateWorklistSchema.parse(await c.req.json());
    const updated = await updateGlobalWorklist(db, id, body);
    if (!updated)
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: updated });
  });

  router.delete("/worklists/:id", async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    if (!await deleteGlobalWorklist(db, id))
      throw new NotFoundError("Worklist", id);
    return c.json({ success: true, data: null });
  });

  return router;
}
