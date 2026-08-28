import type { AppDatabase } from "@/db";
import type { ProtectedEnv } from "@/shared/lib/types";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  deleteResourceTags,
  listResourceIdsByAnyTag,
  loadResourceTagsByResource,
  syncResourceTagsTx,
} from "@/modules/tag/tag.service";
import { NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { describeRoute, errorJson, okJson, onValidationFailure, validator } from "@/shared/lib/openapi";
import { adminRequired, authRequired } from "@/shared/middleware/auth";
import { worklists } from "./schema";

export type WorklistRow = typeof worklists.$inferSelect;

/** Worklist tag binding (tag type='worklist'), passed to the shared tag helpers. */
export const WORKLIST_TAG_BINDING = {
  type: "worklist",
} as const;

// ─── External view ──────────────────────────────────────────────────────
// `projectId` is an internal ULID (or NULL for the global knowledge base) and is
// never exposed: global worklists are reached through admin-only routes and
// project-level worklists through their owning project's nested routes, so the
// owner is always implied by the path. Tags ride the shared `tags`/`tags_refs`
// machinery (tag type 'worklist').
export interface WorklistView {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly { id: string; name: string }[];
  readonly checklist: string | null;
  readonly precautions: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function composeWorklist(row: WorklistRow, tags: readonly { id: string; name: string }[] = []): WorklistView {
  return {
    id: row.id,
    name: row.name,
    tags,
    checklist: row.checklist,
    precautions: row.precautions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Compose a single worklist, loading its tags per-row (detail getters / single writes). */
async function composeWorklistWithTags(db: AppDatabase, row: WorklistRow): Promise<WorklistView> {
  const tags = (await loadResourceTagsByResource(db, WORKLIST_TAG_BINDING, [row.id])).get(row.id) ?? [];
  return composeWorklist(row, tags);
}

/** Compose a set of worklists, batch-loading tags for all rows in one pass (list paths). */
async function composeWorklistList(db: AppDatabase, rows: readonly WorklistRow[]): Promise<readonly WorklistView[]> {
  const tagMap = await loadResourceTagsByResource(db, WORKLIST_TAG_BINDING, rows.map(r => r.id));
  return rows.map(r => composeWorklist(r, tagMap.get(r.id) ?? []));
}

export interface WorklistInput {
  readonly name: string;
  readonly tags?: readonly string[] | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

export interface UpdateWorklistInput {
  readonly name?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
}

// Tags are synced separately through `syncResourceTagsTx`; only plain columns
// flow through the generic patch loop.
const UPDATABLE_KEYS = ["name", "checklist", "precautions"] as const;

// ─── Global knowledge base (project_id NULL) ───────────────────────────────

export async function listGlobalWorklists(db: AppDatabase, tagIds?: readonly string[]): Promise<readonly WorklistView[]> {
  const conditions = [isNull(worklists.projectId)];
  if (tagIds && tagIds.length > 0) {
    // OR semantics: worklists carrying ANY of the selected tags.
    const ids = await listResourceIdsByAnyTag(db, WORKLIST_TAG_BINDING, tagIds);
    if (ids.length === 0)
      return [];
    conditions.push(inArray(worklists.id, ids));
  }
  const rows = await db.select().from(worklists).where(and(...conditions)).orderBy(desc(worklists.createdAt)).all();
  return composeWorklistList(db, rows);
}

export async function createGlobalWorklist(db: AppDatabase, input: WorklistInput): Promise<WorklistView> {
  const id = nanoid();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.insert(worklists).values({
      id,
      projectId: null,
      name: input.name,
      checklist: input.checklist ?? null,
      precautions: input.precautions ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    syncResourceTagsTx(tx, WORKLIST_TAG_BINDING, id, input.tags ?? [], now);
  });
  return composeWorklistWithTags(db, (await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

/** Fetch a global worklist (project_id NULL); project-level rows are never returned. */
export async function getGlobalWorklist(db: AppDatabase, id: string): Promise<WorklistView | undefined> {
  const row = await db.select().from(worklists).where(and(eq(worklists.id, id), isNull(worklists.projectId))).get();
  return row ? composeWorklistWithTags(db, row) : undefined;
}

export async function updateGlobalWorklist(db: AppDatabase, id: string, input: UpdateWorklistInput): Promise<WorklistView | undefined> {
  const existing = await db.select().from(worklists).where(and(eq(worklists.id, id), isNull(worklists.projectId))).get();
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  db.transaction((tx) => {
    tx.update(worklists).set(patch).where(eq(worklists.id, id)).run();
    // Only replace tags when the caller supplied them (omitting leaves them untouched).
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, WORKLIST_TAG_BINDING, id, input.tags, now);
  });
  return composeWorklistWithTags(db, (await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

export async function deleteGlobalWorklist(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await db.select({ id: worklists.id }).from(worklists).where(and(eq(worklists.id, id), isNull(worklists.projectId))).get();
  if (!existing)
    return false;
  await db.delete(worklists).where(eq(worklists.id, id)).run();
  // `tags_refs.resource_id` carries no FK, so drop assignments app-level on hard delete.
  await deleteResourceTags(db, id);
  return true;
}

// ─── Project-level worklists (project_id set) ───────────────────────────────

/** List ONLY the given project's worklists; global (project_id NULL) rows are excluded. */
export async function listProjectWorklists(db: AppDatabase, projectId: string, tagIds?: readonly string[]): Promise<readonly WorklistView[]> {
  const conditions = [eq(worklists.projectId, projectId)];
  if (tagIds && tagIds.length > 0) {
    // OR semantics: worklists carrying ANY of the selected tags.
    const ids = await listResourceIdsByAnyTag(db, WORKLIST_TAG_BINDING, tagIds);
    if (ids.length === 0)
      return [];
    conditions.push(inArray(worklists.id, ids));
  }
  const rows = await db.select().from(worklists).where(and(...conditions)).orderBy(desc(worklists.createdAt)).all();
  return composeWorklistList(db, rows);
}

/**
 * List the worklists a project may reference when creating a work order: its
 * own project-level worklists (empty when the `worklist` section is not
 * mounted, since only that section creates them) plus the global
 * knowledge-base entries. `projectId` is the internal project ULID.
 *
 * The `ship` group name is kept so the payload shape is unchanged by the fold.
 */
export async function listReferenceableWorklists(
  db: AppDatabase,
  projectId: string,
): Promise<{ ship: readonly WorklistView[]; global: readonly WorklistView[] }> {
  const ship = await listProjectWorklists(db, projectId);
  const global = await listGlobalWorklists(db);
  return { ship, global };
}

// `name` is optional here (unlike the global `WorklistInput`): when
// `fromGlobalId` is set the name is copied from the source. The route schema
// guarantees a name is present on the from-scratch path.
export interface CreateProjectWorklistInput {
  readonly name?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly checklist?: string | null | undefined;
  readonly precautions?: string | null | undefined;
  // When set, copy name/checklist/precautions and the tags from this global
  // worklist once. The copy is independent thereafter.
  readonly fromGlobalId?: string | undefined;
}

export type CreateProjectWorklistResult
  = | { readonly status: "ok"; readonly worklist: WorklistView }
    | { readonly status: "global_not_found" };

/**
 * Create a project-level worklist. Either from scratch (body fields) or, when
 * `fromGlobalId` is set, as a ONE-TIME copy of a global knowledge-base entry:
 * the global row's name/checklist/precautions AND its tags are snapshotted into
 * a new independent project-level row, so later edits to the global do not
 * affect this copy.
 */
export async function createProjectWorklist(db: AppDatabase, projectId: string, input: CreateProjectWorklistInput): Promise<CreateProjectWorklistResult> {
  const id = nanoid();
  const now = new Date().toISOString();

  let name = input.name ?? "";
  let checklist = input.checklist ?? null;
  let precautions = input.precautions ?? null;
  let tags: readonly string[] = input.tags ?? [];

  if (input.fromGlobalId !== undefined) {
    const source = await getGlobalWorklist(db, input.fromGlobalId);
    if (!source)
      return { status: "global_not_found" };
    name = source.name;
    checklist = source.checklist;
    precautions = source.precautions;
    // Copy the source's tag NAMES so the project row mirrors the FE prefill.
    tags = source.tags.map(t => t.name);
  }

  db.transaction((tx) => {
    tx.insert(worklists).values({
      id,
      projectId,
      name,
      checklist,
      precautions,
      createdAt: now,
      updatedAt: now,
    }).run();
    syncResourceTagsTx(tx, WORKLIST_TAG_BINDING, id, tags, now);
  });
  return { status: "ok", worklist: await composeWorklistWithTags(db, (await db.select().from(worklists).where(eq(worklists.id, id)).get())!) };
}

/** True when the project holds any non-global worklist — the `worklist` section's `hasData`. */
export async function hasProjectWorklists(db: AppDatabase, projectId: string): Promise<boolean> {
  const row = await db.select({ id: worklists.id }).from(worklists).where(eq(worklists.projectId, projectId)).get();
  return row !== undefined;
}

export async function getProjectWorklist(db: AppDatabase, projectId: string, id: string): Promise<WorklistView | undefined> {
  const row = await db.select().from(worklists).where(and(eq(worklists.id, id), eq(worklists.projectId, projectId))).get();
  return row ? composeWorklistWithTags(db, row) : undefined;
}

export async function updateProjectWorklist(db: AppDatabase, projectId: string, id: string, input: UpdateWorklistInput): Promise<WorklistView | undefined> {
  const existing = await db.select().from(worklists).where(and(eq(worklists.id, id), eq(worklists.projectId, projectId))).get();
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  db.transaction((tx) => {
    tx.update(worklists).set(patch).where(eq(worklists.id, id)).run();
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, WORKLIST_TAG_BINDING, id, input.tags, now);
  });
  return composeWorklistWithTags(db, (await db.select().from(worklists).where(eq(worklists.id, id)).get())!);
}

export async function deleteProjectWorklist(db: AppDatabase, projectId: string, id: string): Promise<boolean> {
  const existing = await db.select({ id: worklists.id }).from(worklists).where(and(eq(worklists.id, id), eq(worklists.projectId, projectId))).get();
  if (!existing)
    return false;
  await db.delete(worklists).where(eq(worklists.id, id)).run();
  // `tags_refs.resource_id` carries no FK, so drop assignments app-level on hard delete.
  await deleteResourceTags(db, id);
  return true;
}

// ─── Route schemas (Hono routers in ship.routes.ts import these) ────────────

// `checklist`/`precautions` are long free-form text (10000 cap); `tags` carry
// the per-tag length (50, the BKD tag convention) + array-size (20) bounds so
// unbounded tag count/length cannot flow into syncResourceTagsTx.
const worklistFields = {
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
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

export const createProjectWorklistSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  fromGlobalId: z.string().min(1).optional(),
  ...worklistFields,
}).refine(
  v => v.fromGlobalId !== undefined || v.name !== undefined,
  { message: "name is required when fromGlobalId is not provided" },
).refine(
  // B5 / Design Constraint 3: `fromGlobalId` snapshots the global row's content
  // (and its tags) wholesale, so mixing it with explicit content fields is
  // contradictory. Reject it here (one or the other); the global snapshot wins.
  v => v.fromGlobalId === undefined
    || (v.name === undefined && v.checklist === undefined && v.precautions === undefined && v.tags === undefined),
  { message: "Cannot combine fromGlobalId with name/checklist/precautions/tags; the global worklist is copied as-is" },
);

// ─── Global knowledge-base router (mounted in protected.ts) ──────────────────
// Reads (list + detail) are open to any authenticated user so a non-admin
// ship-manager can populate the in-dialog "Start from template" selector;
// mutations (create / update / delete) stay admin-only via per-route guards.

// Response schema mirroring `WorklistView` for the OpenAPI spec.
const worklistViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
  checklist: z.string().nullable(),
  precautions: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function worklistRoutes() {
  const router = new Hono<ProtectedEnv>();
  router.use("*", authRequired);

  router.get(
    "/worklists",
    describeRoute({
      tags: ["worklists"],
      summary: "List global knowledge-base worklists",
      responses: { 200: okJson(z.array(worklistViewSchema)), 401: { description: "Unauthenticated", ...errorJson } },
    }),
    validator("query", z.object({ tagId: z.union([z.string(), z.array(z.string())]).optional() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      // Repeated `tagId=` query params combine with OR semantics (any-of); a
      // single value arrives as a scalar, so normalise both to an array.
      const { tagId } = c.req.valid("query");
      const tagIds = tagId === undefined ? undefined : Array.isArray(tagId) ? tagId : [tagId];
      return c.json({ success: true, data: await listGlobalWorklists(db, tagIds) });
    },
  );

  router.post(
    "/worklists",
    describeRoute({
      tags: ["worklists"],
      summary: "Create a global knowledge-base worklist",
      responses: { 201: okJson(worklistViewSchema, "Created"), 403: { description: "Admin only", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("json", createGlobalWorklistSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      return c.json({ success: true, data: await createGlobalWorklist(db, body) }, 201);
    },
  );

  router.get(
    "/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Get a global knowledge-base worklist",
      responses: { 200: okJson(worklistViewSchema), 401: { description: "Unauthenticated", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    validator("param", z.object({ id: z.string() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const wl = await getGlobalWorklist(db, id);
      if (!wl)
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: wl });
    },
  );

  router.patch(
    "/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Update a global knowledge-base worklist",
      responses: { 200: okJson(worklistViewSchema), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson }, 422: { description: "Validation error", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: z.string() }), onValidationFailure),
    validator("json", updateWorklistSchema, onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const updated = await updateGlobalWorklist(db, id, body);
      if (!updated)
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: updated });
    },
  );

  router.delete(
    "/worklists/:id",
    describeRoute({
      tags: ["worklists"],
      summary: "Delete a global knowledge-base worklist",
      responses: { 200: okJson(z.null()), 403: { description: "Admin only", ...errorJson }, 404: { description: "Not found", ...errorJson } },
    }),
    adminRequired,
    validator("param", z.object({ id: z.string() }), onValidationFailure),
    async (c) => {
      const db = c.get("db");
      const { id } = c.req.valid("param");
      if (!await deleteGlobalWorklist(db, id))
        throw new NotFoundError("Worklist", id);
      return c.json({ success: true, data: null });
    },
  );

  return router;
}
