import type { ProjectCapability, ProjectStatus } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase, AppTransaction, RunResult } from "@/db";
import type { FileServiceConfig } from "@/modules/file";
import type { ResourceTagUsageView } from "@/modules/tag/tag.service";
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { finalizeReleasedBlob, getReferenceById, releaseReferenceTx, uploadAndReference } from "@/modules/file";
import { fileReferences } from "@/modules/file/schema";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { procurementDetails } from "@/modules/procurement/schema";
import { settings } from "@/modules/settings/schema";
import { getSetting } from "@/modules/settings/settings.service";
import { ships } from "@/modules/ship/schema";
import {
  listResourceIdsByTag,
  loadResourceTagsByResource,
  syncResourceTagsTx,
} from "@/modules/tag/tag.service";
import { AppError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";
import { seedProjectCategoriesTx } from "./project.global-categories";
import { parseCapabilities, resolveRole, seedDefaultRoles } from "./project.roles";
import { projectMembers, projectRoles, projects } from "./schema";

/** Settings key backing the admin "Project Defaults" cover picker. */
export const PROJECT_DEFAULT_COVER_KEY = "project.defaults.coverReferenceId";

/** Project tag binding (tag type='project'), passed to the shared tag helpers. */
const PROJECT_TAG_BINDING = {
  type: "project",
} as const;

/** owner_type discriminator for a project's cover image file reference. */
export const PROJECT_COVER_OWNER_TYPE = "project_cover";

/**
 * owner_type / owner_id for the single GLOBAL default-cover file reference.
 * Distinct from `project_cover` so the GC/orphan-sweep never confuses the
 * shared default with a per-project cover. The default is a singleton, so the
 * owner_id is a fixed sentinel rather than a project id.
 */
export const PROJECT_DEFAULT_COVER_OWNER_TYPE = "project_cover_default";
const PROJECT_DEFAULT_COVER_OWNER_ID = "global";

/** Build the inline content URL the frontend renders in an <img>. */
function buildCoverUrl(fileId: string, referenceId: string): string {
  return `/api/files/${fileId}/content?ref=${referenceId}&inline=true`;
}

// Escape SQLite LIKE wildcards. Backslash is escaped first (it is the ESCAPE
// char), then `%`/`_`, so the pattern is matched literally. Every LIKE built
// from this MUST carry `ESCAPE '\'` or the backslashes match as literals.
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, "\\$&");
}

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;

// ─── External views ───────────────────────────────────────────────────────
// Routes return these instead of raw rows: `shortId` is the sole external
// project identifier, so the internal ULID (`projects.id`) and the soft-delete
// marker never leave the API. Member rows expose their own nanoid `id` (the
// canonical assignment target) but drop the redundant internal `projectId`.

// A project's tag with its source-type-wide usage count. Computed (never
// stored); used by the list filter to surface the most-used tags first. Alias
// of the shared tag view, whose shape ({id,name,usageCount}) is identical.
export type ProjectTagView = ResourceTagUsageView;

export interface ProjectView {
  readonly id: string; // project short_id
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly tags: readonly ProjectTagView[];
  readonly coverImageUrl: string | null;
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProjectMemberView {
  readonly id: string; // project_members nanoid — external assignment target
  readonly userId: string | null; // null = virtual member
  readonly displayName: string | null;
  readonly roleId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeProject(
  row: ProjectRow,
  projectTagList: readonly ProjectTagView[] = [],
  coverImageUrl: string | null = null,
): ProjectView {
  return {
    id: row.shortId,
    code: row.code,
    name: row.name,
    status: row.status,
    description: row.description,
    tags: projectTagList,
    coverImageUrl,
    creatorId: row.creatorId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function composeMember(row: ProjectMemberRow): ProjectMemberView {
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    roleId: row.roleId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Tags ───────────────────────────────────────────────────────────────
// The vocabulary lives in the shared `tags` table scoped to tag type
// 'project'; the tag module owns the CRUD (/tags routes) and the assignment
// helpers below. Project code only passes the type via PROJECT_TAG_BINDING.

/** Load tags for a set of internal project ids, grouped by project id. */
async function loadTagsByProject(db: AppDatabase, projectIds: readonly string[]): Promise<Map<string, ProjectTagView[]>> {
  return await loadResourceTagsByResource(db, PROJECT_TAG_BINDING, projectIds);
}

async function loadTagsForProject(db: AppDatabase, projectId: string): Promise<ProjectTagView[]> {
  return (await loadTagsByProject(db, [projectId])).get(projectId) ?? [];
}

/**
 * Resolve cover image URLs for a set of project rows, keyed by `cover_reference_id`.
 * Returns a map from reference id to its inline content URL (only references
 * that still resolve to a blob are included).
 */
async function loadCoverUrlsByReference(db: AppDatabase, referenceIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (referenceIds.length === 0)
    return map;
  const rows = await db.select({ id: fileReferences.id, fileId: fileReferences.fileId })
    .from(fileReferences)
    .where(inArray(fileReferences.id, [...referenceIds]))
    .all();
  for (const r of rows)
    map.set(r.id, buildCoverUrl(r.fileId, r.id));
  return map;
}

/**
 * Resolve cover image URLs for a set of project rows, keyed by internal project
 * id. A project shows its own cover when set; otherwise, when it is a ship's
 * base project, it inherits that ship's cover. The inherited URL points at the
 * ship's `ship_cover` reference — the file content route authorizes base-project
 * members through the existing `ship_cover` hook, so the reuse is permission-safe.
 */
async function loadCoverUrlsByProject(db: AppDatabase, rows: readonly ProjectRow[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (rows.length === 0)
    return result;

  // Projects lacking an own cover are candidates for the ship fallback.
  const fallbackProjectIds = rows.filter(r => !r.coverReferenceId).map(r => r.id);
  const shipCoverByProject = new Map<string, string>(); // base project id → ship cover reference id
  if (fallbackProjectIds.length > 0) {
    const shipRows = await db.select({ baseProjectId: ships.baseProjectId, coverReferenceId: ships.coverReferenceId })
      .from(ships)
      .where(and(inArray(ships.baseProjectId, fallbackProjectIds), isNull(ships.deletedAt)))
      .all();
    for (const s of shipRows) {
      if (s.baseProjectId && s.coverReferenceId)
        shipCoverByProject.set(s.baseProjectId, s.coverReferenceId);
    }
  }

  const refIds = [
    ...rows.map(r => r.coverReferenceId).filter((v): v is string => v !== null),
    ...shipCoverByProject.values(),
  ];
  const urlByRef = await loadCoverUrlsByReference(db, refIds);

  for (const r of rows) {
    const refId = r.coverReferenceId ?? shipCoverByProject.get(r.id) ?? null;
    const url = refId ? urlByRef.get(refId) : undefined;
    if (url)
      result.set(r.id, url);
  }
  return result;
}

async function loadCoverUrlForProject(db: AppDatabase, row: ProjectRow): Promise<string | null> {
  return (await loadCoverUrlsByProject(db, [row])).get(row.id) ?? null;
}

/**
 * Replace a project's tags with the given names. Delegates to the shared tag
 * helper (tag type 'project'). Runs synchronously inside a tx.
 */
function syncTagsTx(tx: AppTransaction, projectId: string, names: readonly string[], now: string): void {
  syncResourceTagsTx(tx, PROJECT_TAG_BINDING, projectId, names, now);
}

// ─── Project CRUD ───────────────────────────────────────────────────────

export interface CreateProjectInput {
  readonly code?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly creatorId: string;
  // Optional link to a ship. Set by `createShip` so the base project points
  // back at its ship. Additive — absent for ordinary project creation.
  readonly shipId?: string | undefined;
  // Optional cover reference. Normally a project gets its cover via the
  // cover-image upload endpoint; `createProject` fills this from the
  // `project.defaults.coverReferenceId` setting when the caller omits it.
  readonly coverReferenceId?: string | null | undefined;
}

/**
 * Synchronous core of project creation: insert the project row, seed default
 * roles, add the creator as a "Project Owner" member, and sync tags. Runs
 * entirely inside the caller's transaction so it can be composed into a larger
 * atomic unit (e.g. `createShip`). Returns the internal ULID and short id.
 */
export function createProjectTx(tx: AppTransaction, input: CreateProjectInput): { id: string; shortId: string } {
  const id = ulid();
  const shortId = nanoid();
  // `code` is a standalone label (separate from shortId) and is always stored
  // lowercase: both the auto-generated value and any supplied code are lowercased.
  const code = (input.code ?? `p-${shortId}`).toLowerCase();
  const now = new Date().toISOString();

  tx.insert(projects).values({
    id,
    shortId,
    code,
    name: input.name,
    // New projects are always created active; archiving is a later PATCH.
    status: "active",
    description: input.description ?? null,
    shipId: input.shipId ?? null,
    coverReferenceId: input.coverReferenceId ?? null,
    creatorId: input.creatorId,
    version: 1,
    deletedAt: null,
    updatedAt: now,
  }).run();

  const { ownerRoleId } = seedDefaultRoles(tx, id, now);

  tx.insert(projectMembers).values({
    id: nanoid(),
    projectId: id,
    userId: input.creatorId,
    displayName: null,
    roleId: ownerRoleId,
    title: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Copy-on-create: seed this project's procurement categories from the
  // current global template set (no-op when none are defined).
  seedProjectCategoriesTx(tx, id, now);

  if (input.tags && input.tags.length > 0)
    syncTagsTx(tx, id, input.tags, now);

  return { id, shortId };
}

/**
 * Create a project and, in the same synchronous transaction, seed its default
 * roles and add the creator as a "Project Owner" member. `code` is
 * auto-generated from the short id when not supplied. bun:sqlite transactions
 * are synchronous — keep the callback sync so COMMIT/ROLLBACK semantics hold.
 */
export async function createProject(db: AppDatabase, input: CreateProjectInput): Promise<ProjectRow> {
  // Apply the admin "Project Defaults" cover for projects that omit one. The
  // setting read is async, so it happens before the sync tx; its existence is
  // re-verified *inside* the tx (below) to close the TOCTOU against a concurrent
  // default-cover removal that would otherwise make the insert FK reject.
  const defaultCoverRefId = input.coverReferenceId === undefined
    ? await getSetting(db, PROJECT_DEFAULT_COVER_KEY)
    : null;

  let id = "";
  db.transaction((tx) => {
    let coverReferenceId = input.coverReferenceId ?? null;
    // Re-check the default-cover reference existence atomically with the insert.
    // A dangling default is dropped to null so a concurrent removal can never
    // block project creation; an explicit caller-supplied ref is trusted as-is.
    if (coverReferenceId === null && defaultCoverRefId) {
      const exists = tx.select({ id: fileReferences.id }).from(fileReferences).where(eq(fileReferences.id, defaultCoverRefId)).get();
      coverReferenceId = exists ? defaultCoverRefId : null;
    }
    id = createProjectTx(tx, { ...input, coverReferenceId }).id;
  });

  return (await db.select().from(projects).where(eq(projects.id, id)).get())!;
}

export async function getProjectByShortId(db: AppDatabase, shortId: string): Promise<ProjectRow | undefined> {
  return await db.select().from(projects).where(
    and(eq(projects.shortId, shortId), isNull(projects.deletedAt)),
  ).get();
}

/** Compose a single project view with its tags and cover image loaded. */
export async function composeProjectWithTags(db: AppDatabase, row: ProjectRow): Promise<ProjectView> {
  return composeProject(row, await loadTagsForProject(db, row.id), await loadCoverUrlForProject(db, row));
}

/** Resolve the internal project id (ULID) from a short id, excluding soft-deleted rows. */
export async function resolveProjectId(db: AppDatabase, shortId: string): Promise<string | null> {
  const row = await db.select({ id: projects.id }).from(projects).where(
    and(eq(projects.shortId, shortId), isNull(projects.deletedAt)),
  ).get();
  return row?.id ?? null;
}

export interface ListProjectParams {
  readonly status?: ProjectStatus | undefined;
  readonly q?: string | undefined;
  readonly tagId?: string | undefined;
  // Hide archived projects (the default list view shows them only when the
  // caller explicitly filters `status: "archived"`). No effect when `status`
  // is set. Defaults to off so other callers (e.g. search) are unchanged.
  readonly excludeArchived?: boolean | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  // When set (non-admin callers), restrict to projects this user is a member of.
  readonly memberUserId?: string | undefined;
}

export interface ListProjectResult {
  readonly data: readonly ProjectView[];
  readonly total: number;
}

export async function listProjects(db: AppDatabase, params: ListProjectParams = {}): Promise<ListProjectResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const conditions = [isNull(projects.deletedAt)];
  if (params.status)
    conditions.push(eq(projects.status, params.status));
  else if (params.excludeArchived)
    conditions.push(ne(projects.status, "archived"));
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(
      sql`${projects.name} LIKE ${pattern} ESCAPE '\\'`,
      sql`${projects.code} LIKE ${pattern} ESCAPE '\\'`,
    )!);
  }
  if (params.tagId) {
    const taggedIds = await listResourceIdsByTag(db, PROJECT_TAG_BINDING, params.tagId);
    if (taggedIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(projects.id, taggedIds));
  }
  if (params.memberUserId !== undefined) {
    const memberProjectIds = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, params.memberUserId))
      .all();
    if (memberProjectIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(projects.id, memberProjectIds.map(r => r.projectId)));
  }
  const where = and(...conditions);

  const totalRow = await db.select({ value: count() }).from(projects).where(where).get();
  const total = totalRow?.value ?? 0;

  const rows = await db.select().from(projects).where(where).orderBy(desc(projects.id)).limit(limit).offset((page - 1) * limit).all();
  const tagMap = await loadTagsByProject(db, rows.map(r => r.id));
  const coverMap = await loadCoverUrlsByProject(db, rows);
  const data = rows.map(r => composeProject(
    r,
    tagMap.get(r.id) ?? [],
    coverMap.get(r.id) ?? null,
  ));

  return { data, total };
}

export interface UpdateProjectInput {
  readonly name?: string | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  /**
   * Optimistic-concurrency guard. When supplied, the update only proceeds if
   * the stored `version` still equals it; a mismatch returns a
   * {@link ProjectVersionConflict} instead of writing (lost-update guard,
   * mirroring `updateItem`/`updateDocument`).
   */
  readonly expectedVersion?: number | undefined;
}

/**
 * Optimistic-concurrency conflict result. Returned by {@link updateProject}
 * when the caller's `expectedVersion` no longer matches the stored row.
 */
export interface ProjectVersionConflict {
  readonly conflict: true;
  readonly current: ProjectRow;
}

export function isProjectVersionConflict(v: unknown): v is ProjectVersionConflict {
  return typeof v === "object" && v !== null && (v as { conflict?: unknown }).conflict === true;
}

export async function updateProject(db: AppDatabase, shortId: string, input: UpdateProjectInput): Promise<ProjectRow | ProjectVersionConflict | undefined> {
  const project = await getProjectByShortId(db, shortId);
  if (!project)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now, version: sql`${projects.version} + 1` };
  // `code` is immutable after creation, so it is intentionally excluded here.
  for (const key of ["name", "status", "description"] as const) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  // Scope the write on `version` when an expectedVersion is supplied so the
  // check + bump are atomic (no read-then-write race). A zero-row update
  // means a concurrent writer moved the version on between read and write.
  const stale = db.transaction((tx) => {
    const where = input.expectedVersion !== undefined
      ? and(eq(projects.id, project.id), eq(projects.version, input.expectedVersion))
      : eq(projects.id, project.id);
    const result = tx.update(projects).set(patch).where(where).run() as unknown as RunResult;
    if (input.expectedVersion !== undefined && result.changes === 0)
      return true;
    if (input.tags !== undefined)
      syncTagsTx(tx, project.id, input.tags, now);
    return false;
  });

  if (stale) {
    const current = await db.select().from(projects).where(eq(projects.id, project.id)).get();
    return current ? { conflict: true, current } : undefined;
  }

  return await db.select().from(projects).where(eq(projects.id, project.id)).get();
}

/**
 * Soft-delete a project and cascade the soft-delete to its child work items.
 *
 * In one transaction we stamp `deleted_at` on the project row and on every live
 * issue / procurement item belonging to it (resolved via the `*_details`
 * `project_id` link), tearing down each item's relation tuples — mirroring
 * `softDeleteItem`. Without this, the children kept `deleted_at IS NULL` (still
 * "live") and accumulated unbounded under a project that no list/detail read can
 * reach (those resolve the parent first and filter `deleted_at IS NULL`). See
 * docs/decisions/008 for the cascade contract. Members / roles / categories /
 * tags are intentionally retained (the project row still exists); there is no
 * project restore endpoint, so the cascade is one-way by design.
 */
export async function softDeleteProject(db: AppDatabase, shortId: string): Promise<void> {
  const project = await db.select().from(projects).where(eq(projects.shortId, shortId)).get();
  if (!project)
    return;
  const now = new Date().toISOString();
  db.transaction((tx) => {
    const updated = tx.update(projects)
      .set({ deletedAt: now, updatedAt: now, version: sql`${projects.version} + 1` })
      .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
      .run() as unknown as RunResult;

    // Already soft-deleted — don't re-stamp the children.
    if (updated.changes === 0)
      return;

    const childItemIds = [
      ...tx.select({ itemId: issueDetails.itemId }).from(issueDetails).where(eq(issueDetails.projectId, project.id)).all(),
      ...tx.select({ itemId: procurementDetails.itemId }).from(procurementDetails).where(eq(procurementDetails.projectId, project.id)).all(),
    ].map(r => r.itemId);

    if (childItemIds.length === 0)
      return;

    tx.update(items)
      .set({ deletedAt: now, updatedAt: now, version: sql`${items.version} + 1` })
      .where(and(inArray(items.id, childItemIds), isNull(items.deletedAt)))
      .run();
    tx.delete(relationTuples)
      .where(and(eq(relationTuples.namespace, "item"), inArray(relationTuples.objectId, childItemIds)))
      .run();
  });
}

// ─── Cover image ──────────────────────────────────────────────────────────
//
// One cover per project, modelled as a `project_cover` file reference. We
// always repoint `projects.cover_reference_id` BEFORE releasing the previous
// reference, because the SQLite `ALTER TABLE ADD COLUMN` FK can't carry an
// `ON DELETE SET NULL` action — releasing a still-referenced row would fail.

/** Replace a project's cover image. Returns the updated row, or undefined when the project is gone. */
export async function setProjectCover(
  db: AppDatabase,
  config: Config,
  projectId: string,
  file: File,
  uploadedBy: string,
): Promise<ProjectRow | undefined> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project)
    return undefined;

  const { reference } = await uploadAndReference(db, config, {
    file,
    ownerType: PROJECT_COVER_OWNER_TYPE,
    ownerId: projectId,
    uploadedBy,
  });

  const now = new Date().toISOString();
  const previous = project.coverReferenceId;
  // Repoint + release in one tx so an interrupted change can never leave the
  // previous reference unreleased (the orphan-blob leak window of F4). The
  // sync-GC blob delete runs after commit — driver I/O can't run in a sync tx.
  const drained = db.transaction((tx) => {
    tx.update(projects)
      .set({ coverReferenceId: reference.id, updatedAt: now, version: sql`${projects.version} + 1` })
      .where(eq(projects.id, projectId))
      .run();
    return previous && previous !== reference.id ? releaseReferenceTx(tx, previous) : null;
  });
  await finalizeReleasedBlob(db, config, drained);

  return await db.select().from(projects).where(eq(projects.id, projectId)).get();
}

/** Remove a project's cover image (no-op when it has none). */
export async function removeProjectCover(
  db: AppDatabase,
  config: FileServiceConfig,
  projectId: string,
): Promise<ProjectRow | undefined> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project)
    return undefined;
  const previous = project.coverReferenceId;
  if (!previous)
    return project;

  const now = new Date().toISOString();
  // Clear + release atomically (F4): no window where the cover is cleared but
  // the old reference is left unreleased.
  const drained = db.transaction((tx) => {
    tx.update(projects)
      .set({ coverReferenceId: null, updatedAt: now, version: sql`${projects.version} + 1` })
      .where(eq(projects.id, projectId))
      .run();
    return releaseReferenceTx(tx, previous);
  });
  await finalizeReleasedBlob(db, config, drained);

  return await db.select().from(projects).where(eq(projects.id, projectId)).get();
}

// ─── Global default cover ───────────────────────────────────────────────────
//
// One shared cover image, applied to new projects at creation
// (`resolveDefaultCoverReferenceId` reads PROJECT_DEFAULT_COVER_KEY). Modelled
// as a `project_cover_default` file reference whose id is stored in that
// setting. Replace/remove release the prior reference so no blob is orphaned.

export interface DefaultCoverView {
  readonly referenceId: string | null;
  readonly url: string | null;
}

/**
 * Read the current global default cover. Returns nulls when unset or when the
 * stored reference no longer exists (dangling default), mirroring
 * `resolveDefaultCoverReferenceId`.
 */
export async function getDefaultProjectCover(db: AppDatabase): Promise<DefaultCoverView> {
  const referenceId = await getSetting(db, PROJECT_DEFAULT_COVER_KEY);
  if (!referenceId)
    return { referenceId: null, url: null };
  const reference = await getReferenceById(db, referenceId);
  if (!reference)
    return { referenceId: null, url: null };
  return { referenceId, url: buildCoverUrl(reference.fileId, referenceId) };
}

/**
 * Upload / replace the global default cover. Stores the new reference id in
 * PROJECT_DEFAULT_COVER_KEY and releases the previous reference (if any) so the
 * key always points at a live reference that create-seeding can consume.
 */
export async function setDefaultProjectCover(
  db: AppDatabase,
  config: Config,
  file: File,
  uploadedBy: string,
): Promise<DefaultCoverView> {
  const previous = await getSetting(db, PROJECT_DEFAULT_COVER_KEY);

  const { reference, file: stored } = await uploadAndReference(db, config, {
    file,
    ownerType: PROJECT_DEFAULT_COVER_OWNER_TYPE,
    ownerId: PROJECT_DEFAULT_COVER_OWNER_ID,
    uploadedBy,
  });

  // Repoint the setting + release the old reference atomically (F4): the
  // settings upsert is inlined into the tx (the standalone `setSetting`
  // helper is not transaction-aware) so a crash can't leave the key pointing
  // at the new reference while the previous one stays unreleased.
  const now = new Date().toISOString();
  const drained = db.transaction((tx) => {
    tx.insert(settings).values({
      key: PROJECT_DEFAULT_COVER_KEY,
      value: reference.id,
      updatedBy: uploadedBy,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: settings.key,
      set: { value: reference.id, updatedBy: uploadedBy, updatedAt: now },
    }).run();
    return previous && previous !== reference.id ? releaseReferenceTx(tx, previous) : null;
  });
  await finalizeReleasedBlob(db, config, drained);

  return { referenceId: reference.id, url: buildCoverUrl(stored.id, reference.id) };
}

/**
 * Remove the global default cover: release the current reference (if any) and
 * clear the setting. Idempotent — safe to call when no default is set.
 */
export async function removeDefaultProjectCover(db: AppDatabase, config: FileServiceConfig): Promise<void> {
  const previous = await getSetting(db, PROJECT_DEFAULT_COVER_KEY);
  // Clear the setting + release the old reference atomically (F4); the delete
  // is inlined into the tx since the standalone helper is not tx-aware.
  const drained = db.transaction((tx) => {
    tx.delete(settings).where(eq(settings.key, PROJECT_DEFAULT_COVER_KEY)).run();
    return previous ? releaseReferenceTx(tx, previous) : null;
  });
  await finalizeReleasedBlob(db, config, drained);
}

// ─── Member CRUD ────────────────────────────────────────────────────────

export interface AddMemberInput {
  readonly roleId: string;
  readonly userId?: string | null | undefined; // real member
  readonly displayName?: string | null | undefined; // virtual member
  readonly title?: string | null | undefined;
}

/**
 * Count the members of a project that hold the `kind='owner'` role. Used to
 * enforce the "at least one owner must remain" invariant before a demotion or
 * removal that targets an owner.
 */
async function countOwnerMembers(db: AppDatabase, projectId: string): Promise<number> {
  const row = await db.select({ value: count() })
    .from(projectMembers)
    .innerJoin(projectRoles, eq(projectRoles.id, projectMembers.roleId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectRoles.kind, "owner")))
    .get();
  return row?.value ?? 0;
}

/**
 * Validate a real (`userId`-bearing) member assignment: the user must exist and
 * must not already be a member of the project. Fail-closed with a clean 4xx
 * instead of letting the FK / unique-index violation bubble to a 500.
 * `excludeMemberId` is skipped from the duplicate check so a no-op update of an
 * existing member's own row is allowed.
 */
async function assertAssignableUser(
  db: AppDatabase,
  projectId: string,
  userId: string,
  excludeMemberId?: string,
): Promise<void> {
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!exists)
    throw new NotFoundError("User", userId);
  const conflict = await db.select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .get();
  if (conflict && conflict.id !== excludeMemberId)
    throw new AppError("User is already a member of this project", 409, "CONFLICT");
}

export async function addMember(db: AppDatabase, projectId: string, input: AddMemberInput): Promise<ProjectMemberRow> {
  if (input.userId != null && input.userId !== "")
    await assertAssignableUser(db, projectId, input.userId);
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(projectMembers).values({
    id,
    projectId,
    userId: input.userId ?? null,
    displayName: input.displayName ?? null,
    roleId: input.roleId,
    title: input.title ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(projectMembers).where(eq(projectMembers.id, id)).get())!;
}

export async function listMembers(db: AppDatabase, projectId: string): Promise<readonly ProjectMemberRow[]> {
  return await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(desc(projectMembers.createdAt)).all();
}

export interface UpdateMemberInput {
  readonly roleId?: string | undefined;
  readonly displayName?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly userId?: string | null | undefined; // promote a virtual member to a real user
}

export async function updateMember(
  db: AppDatabase,
  projectId: string,
  memberId: string,
  input: UpdateMemberInput,
): Promise<ProjectMemberRow | undefined> {
  const existing = await db.select().from(projectMembers).where(
    and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)),
  ).get();
  if (!existing)
    return undefined;

  // Promotion / re-point to a real user: the user must exist and not already be
  // a member (its own row excepted) — fail-closed with a clean 4xx (F4).
  if (input.userId != null && input.userId !== "")
    await assertAssignableUser(db, projectId, input.userId, memberId);

  // Last-owner guard (F3): changing the sole owner's role to a non-owner role
  // would leave the project with no owner. Block it.
  if (input.roleId !== undefined && input.roleId !== existing.roleId) {
    const currentRole = await resolveRole(db, projectId, existing.roleId);
    if (currentRole?.kind === "owner") {
      const nextRole = await resolveRole(db, projectId, input.roleId);
      if (nextRole?.kind !== "owner" && await countOwnerMembers(db, projectId) <= 1)
        throw new ValidationError("Cannot demote the last owner", { roleId: "At least one owner must remain" });
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.roleId !== undefined)
    patch.roleId = input.roleId;
  if (input.displayName !== undefined)
    patch.displayName = input.displayName;
  if (input.title !== undefined)
    patch.title = input.title;
  if (input.userId !== undefined)
    patch.userId = input.userId;

  await db.update(projectMembers).set(patch).where(eq(projectMembers.id, memberId)).run();
  return await db.select().from(projectMembers).where(eq(projectMembers.id, memberId)).get();
}

export async function removeMember(db: AppDatabase, projectId: string, memberId: string): Promise<boolean> {
  const existing = await db.select().from(projectMembers).where(
    and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)),
  ).get();
  if (!existing)
    return false;

  // Last-owner guard (F3): refuse to remove the only member holding the owner
  // role, which would lock ordinary administration out of the project.
  const role = await resolveRole(db, projectId, existing.roleId);
  if (role?.kind === "owner" && await countOwnerMembers(db, projectId) <= 1)
    throw new ValidationError("Cannot remove the last owner", { memberId: "At least one owner must remain" });

  const result = await db.delete(projectMembers)
    .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
    .run() as unknown as { changes: number };
  return result.changes > 0;
}

// ─── Public contract (consumed by issue / procurement / drive modules) ─────

/** True when `userId` (a real user) holds any member row on the project. */
export async function isMember(db: AppDatabase, projectId: string, userId: string): Promise<boolean> {
  const row = await db.select({ id: projectMembers.id }).from(projectMembers).where(
    and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  ).get();
  return !!row;
}

/**
 * Resolve the capabilities a real user has on a project (via their member row's
 * role), or `null` when they are not a member. Virtual members carry no
 * `userId` so they never resolve here.
 */
export async function getMemberCapabilities(db: AppDatabase, projectId: string, userId: string): Promise<Set<ProjectCapability> | null> {
  const row = await db.select({ capabilities: projectRoles.capabilities })
    .from(projectMembers)
    .innerJoin(projectRoles, eq(projectRoles.id, projectMembers.roleId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .get();
  if (!row)
    return null;
  return new Set(parseCapabilities(row.capabilities));
}

/** True when the user is a member whose role grants `capability`. */
export async function hasCapability(db: AppDatabase, projectId: string, userId: string, capability: ProjectCapability): Promise<boolean> {
  const caps = await getMemberCapabilities(db, projectId, userId);
  return caps?.has(capability) ?? false;
}

export interface AssignableMember {
  readonly id: string;
  readonly userId: string | null;
}

/**
 * Validate that a `project_members.id` belongs to the given project and return
 * its assignment-relevant fields. Used by issue / procurement to validate an
 * assignment target. `userId` is null for virtual members.
 */
export async function resolveAssignableMember(
  db: AppDatabase,
  projectId: string,
  memberId: string,
): Promise<AssignableMember | null> {
  const row = await db.select({
    id: projectMembers.id,
    userId: projectMembers.userId,
  }).from(projectMembers).where(
    and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)),
  ).get();
  return row ?? null;
}
