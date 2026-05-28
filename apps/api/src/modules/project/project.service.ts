import type { ProjectCapability, ProjectStatus } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase, AppTransaction } from "@/db";
import type { FileServiceConfig } from "@/modules/file";
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { releaseReference, uploadAndReference } from "@/modules/file";
import { fileReferences } from "@/modules/file/schema";
import { getSetting } from "@/modules/settings/settings.service";
import { ships } from "@/modules/ship/schema";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";
import { seedProjectCategoriesTx } from "./project.global-categories";
import { parseCapabilities, seedDefaultRoles } from "./project.roles";
import { PROJECT_STATUSES, projectMembers, projectRoles, projects, projectTags, tags } from "./schema";

/** Settings keys backing the admin "Project Defaults" section. */
export const PROJECT_DEFAULT_STATUS_KEY = "project.defaults.status";
export const PROJECT_DEFAULT_COVER_KEY = "project.defaults.coverReferenceId";

/** Max length for a tag name, mirrored by the route-level zod schema. */
const TAG_NAME_MAX = 50;

/** owner_type discriminator for a project's cover image file reference. */
export const PROJECT_COVER_OWNER_TYPE = "project_cover";

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

export interface ProjectTagView {
  readonly id: string;
  readonly name: string;
  // Number of projects referencing this tag. Computed (never stored); used by
  // the list filter to surface the most-used tags first.
  readonly usageCount: number;
}

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

export async function listTags(db: AppDatabase): Promise<readonly ProjectTagView[]> {
  // usageCount = number of project_tags rows per tag (0 for orphaned tags).
  // Order most-used first, breaking ties by name so the list is stable.
  const usageCount = count(projectTags.tagId);
  return await db
    .select({ id: tags.id, name: tags.name, usageCount })
    .from(tags)
    .leftJoin(projectTags, eq(projectTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(desc(usageCount), tags.name)
    .all();
}

/** Count the projects currently referencing a tag. */
async function tagUsageCount(db: AppDatabase, tagId: string): Promise<number> {
  const row = await db.select({ value: count() }).from(projectTags).where(eq(projectTags.tagId, tagId)).get();
  return row?.value ?? 0;
}

// ─── Tag admin (admin-only CRUD over the global vocabulary) ─────────────

/** Create a tag. Names are trimmed; duplicates (exact match) are rejected. */
export async function createTag(db: AppDatabase, name: string): Promise<ProjectTagView> {
  const trimmed = name.trim();
  if (!trimmed)
    throw new ValidationError("Tag name is required", { name: "Required" });
  if (trimmed.length > TAG_NAME_MAX)
    throw new ValidationError(`Tag name must be at most ${TAG_NAME_MAX} characters`, { name: "Too long" });
  const existing = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, trimmed)).get();
  if (existing)
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(tags).values({ id, name: trimmed, createdAt: now, updatedAt: now }).run();
  return { id, name: trimmed, usageCount: 0 };
}

/** Rename a tag. Returns undefined when the tag is gone; rejects a name collision. */
export async function renameTag(db: AppDatabase, id: string, name: string): Promise<ProjectTagView | undefined> {
  const trimmed = name.trim();
  if (!trimmed)
    throw new ValidationError("Tag name is required", { name: "Required" });
  if (trimmed.length > TAG_NAME_MAX)
    throw new ValidationError(`Tag name must be at most ${TAG_NAME_MAX} characters`, { name: "Too long" });

  const existing = await db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get();
  if (!existing)
    return undefined;
  const collision = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.name, trimmed), ne(tags.id, id))).get();
  if (collision)
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const now = new Date().toISOString();
  await db.update(tags).set({ name: trimmed, updatedAt: now }).where(eq(tags.id, id)).run();
  return { id, name: trimmed, usageCount: await tagUsageCount(db, id) };
}

/**
 * Delete a tag, cascade-unlinking it from every project first. Both deletes run
 * in one transaction; no in-use block — removing a tag simply untags its
 * projects. Returns false when the tag does not exist.
 */
export async function deleteTag(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get();
  if (!existing)
    return false;
  db.transaction((tx) => {
    tx.delete(projectTags).where(eq(projectTags.tagId, id)).run();
    tx.delete(tags).where(eq(tags.id, id)).run();
  });
  return true;
}

/** Load tags for a set of internal project ids, grouped by project id. */
async function loadTagsByProject(db: AppDatabase, projectIds: readonly string[]): Promise<Map<string, ProjectTagView[]>> {
  const map = new Map<string, ProjectTagView[]>();
  if (projectIds.length === 0)
    return map;
  const rows = await db.select({
    projectId: projectTags.projectId,
    id: tags.id,
    name: tags.name,
    // Correlated count so embedded project tags carry the same usageCount the
    // global tag list reports.
    usageCount: sql<number>`(SELECT COUNT(*) FROM project_tags WHERE project_tags.tag_id = ${tags.id})`,
  })
    .from(projectTags)
    .innerJoin(tags, eq(tags.id, projectTags.tagId))
    .where(inArray(projectTags.projectId, [...projectIds]))
    .all();
  for (const r of rows) {
    const list = map.get(r.projectId) ?? [];
    list.push({ id: r.id, name: r.name, usageCount: r.usageCount });
    map.set(r.projectId, list);
  }
  return map;
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
 * Replace a project's tags with the given names (upsert into the global `tags`
 * vocabulary, then rewrite `project_tags`). Runs synchronously inside a tx.
 */
function syncTagsTx(tx: AppTransaction, projectId: string, names: readonly string[], now: string): void {
  tx.delete(projectTags).where(eq(projectTags.projectId, projectId)).run();
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase()))
      continue;
    seen.add(name.toLowerCase());
    const existing = tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    let tagId = existing?.id;
    if (!tagId) {
      tagId = nanoid();
      tx.insert(tags).values({ id: tagId, name, createdAt: now, updatedAt: now }).run();
    }
    tx.insert(projectTags).values({ projectId, tagId }).run();
  }
}

// ─── Project CRUD ───────────────────────────────────────────────────────

export interface CreateProjectInput {
  readonly code?: string | undefined;
  readonly name: string;
  readonly status?: ProjectStatus | undefined;
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
 * roles, add the creator as a "Project Manager" member, and sync tags. Runs
 * entirely inside the caller's transaction so it can be composed into a larger
 * atomic unit (e.g. `createShip`). Returns the internal ULID and short id.
 */
export function createProjectTx(tx: AppTransaction, input: CreateProjectInput): { id: string; shortId: string } {
  const id = ulid();
  const shortId = nanoid();
  const code = input.code ?? `P-${shortId.toUpperCase()}`;
  const now = new Date().toISOString();

  tx.insert(projects).values({
    id,
    shortId,
    code,
    name: input.name,
    status: input.status ?? "active",
    description: input.description ?? null,
    shipId: input.shipId ?? null,
    coverReferenceId: input.coverReferenceId ?? null,
    creatorId: input.creatorId,
    version: 1,
    deletedAt: null,
    updatedAt: now,
  }).run();

  const { pmRoleId } = seedDefaultRoles(tx, id, now);

  tx.insert(projectMembers).values({
    id: nanoid(),
    projectId: id,
    userId: input.creatorId,
    displayName: null,
    roleId: pmRoleId,
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
 * Resolve the default project status from settings, falling back to "active"
 * when the setting is unset or holds an unknown status.
 */
async function resolveDefaultStatus(db: AppDatabase): Promise<ProjectStatus> {
  const raw = await getSetting(db, PROJECT_DEFAULT_STATUS_KEY);
  return raw && (PROJECT_STATUSES as readonly string[]).includes(raw) ? raw as ProjectStatus : "active";
}

/**
 * Resolve the default cover reference id from settings. Returns null when unset
 * or when the configured reference no longer exists, so a dangling default can
 * never block project creation (the FK would otherwise reject the insert).
 */
async function resolveDefaultCoverReferenceId(db: AppDatabase): Promise<string | null> {
  const refId = await getSetting(db, PROJECT_DEFAULT_COVER_KEY);
  if (!refId)
    return null;
  const exists = await db.select({ id: fileReferences.id }).from(fileReferences).where(eq(fileReferences.id, refId)).get();
  return exists ? refId : null;
}

/**
 * Create a project and, in the same synchronous transaction, seed its default
 * roles and add the creator as a "Project Manager" member. `code` is
 * auto-generated from the short id when not supplied. bun:sqlite transactions
 * are synchronous — keep the callback sync so COMMIT/ROLLBACK semantics hold.
 */
export async function createProject(db: AppDatabase, input: CreateProjectInput): Promise<ProjectRow> {
  // Apply the admin "Project Defaults" for fields the payload omits. Explicit
  // values in `input` always win; settings resolve async, before the sync tx.
  const status = input.status ?? await resolveDefaultStatus(db);
  const coverReferenceId = input.coverReferenceId ?? await resolveDefaultCoverReferenceId(db);

  let id = "";
  db.transaction((tx) => {
    id = createProjectTx(tx, { ...input, status, coverReferenceId }).id;
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
    const taggedIds = await db.select({ projectId: projectTags.projectId }).from(projectTags).where(eq(projectTags.tagId, params.tagId)).all();
    if (taggedIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(projects.id, taggedIds.map(r => r.projectId)));
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
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
}

export async function updateProject(db: AppDatabase, shortId: string, input: UpdateProjectInput): Promise<ProjectRow | undefined> {
  const project = await getProjectByShortId(db, shortId);
  if (!project)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now, version: sql`${projects.version} + 1` };
  for (const key of ["code", "name", "status", "description"] as const) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  db.transaction((tx) => {
    tx.update(projects).set(patch).where(eq(projects.id, project.id)).run();
    if (input.tags !== undefined)
      syncTagsTx(tx, project.id, input.tags, now);
  });
  return await db.select().from(projects).where(eq(projects.id, project.id)).get();
}

/**
 * Soft-delete a project (stamp `deleted_at`). Reads everywhere filter on
 * `deleted_at IS NULL`, so members / issues / procurement stay intact and
 * simply become invisible.
 */
export async function softDeleteProject(db: AppDatabase, shortId: string): Promise<void> {
  const project = await db.select().from(projects).where(eq(projects.shortId, shortId)).get();
  if (!project)
    return;
  const now = new Date().toISOString();
  await db.update(projects)
    .set({ deletedAt: now, updatedAt: now, version: sql`${projects.version} + 1` })
    .where(and(eq(projects.id, project.id), isNull(projects.deletedAt)))
    .run();
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
  await db.update(projects)
    .set({ coverReferenceId: reference.id, updatedAt: now, version: sql`${projects.version} + 1` })
    .where(eq(projects.id, projectId))
    .run();

  const previous = project.coverReferenceId;
  if (previous && previous !== reference.id)
    await releaseReference(db, config, { referenceId: previous });

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
  await db.update(projects)
    .set({ coverReferenceId: null, updatedAt: now, version: sql`${projects.version} + 1` })
    .where(eq(projects.id, projectId))
    .run();
  await releaseReference(db, config, { referenceId: previous });

  return await db.select().from(projects).where(eq(projects.id, projectId)).get();
}

// ─── Member CRUD ────────────────────────────────────────────────────────

export interface AddMemberInput {
  readonly roleId: string;
  readonly userId?: string | null | undefined; // real member
  readonly displayName?: string | null | undefined; // virtual member
  readonly title?: string | null | undefined;
}

export async function addMember(db: AppDatabase, projectId: string, input: AddMemberInput): Promise<ProjectMemberRow> {
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
