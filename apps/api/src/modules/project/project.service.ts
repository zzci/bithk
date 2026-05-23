import type { ProjectCapability, ProjectStatus } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid, ulid } from "@/shared/lib/id";
import { parseCapabilities, seedDefaultRoles } from "./project.roles";
import { projectMembers, projectRoles, projects, projectTags, tags } from "./schema";

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
}

export interface ProjectView {
  readonly id: string; // project short_id
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly tags: readonly ProjectTagView[];
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

export function composeProject(row: ProjectRow, projectTagList: readonly ProjectTagView[] = []): ProjectView {
  return {
    id: row.shortId,
    code: row.code,
    name: row.name,
    status: row.status,
    description: row.description,
    tags: projectTagList,
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
  return await db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(tags.name).all();
}

/** Load tags for a set of internal project ids, grouped by project id. */
async function loadTagsByProject(db: AppDatabase, projectIds: readonly string[]): Promise<Map<string, ProjectTagView[]>> {
  const map = new Map<string, ProjectTagView[]>();
  if (projectIds.length === 0)
    return map;
  const rows = await db.select({ projectId: projectTags.projectId, id: tags.id, name: tags.name })
    .from(projectTags)
    .innerJoin(tags, eq(tags.id, projectTags.tagId))
    .where(inArray(projectTags.projectId, [...projectIds]))
    .all();
  for (const r of rows) {
    const list = map.get(r.projectId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.projectId, list);
  }
  return map;
}

async function loadTagsForProject(db: AppDatabase, projectId: string): Promise<ProjectTagView[]> {
  return (await loadTagsByProject(db, [projectId])).get(projectId) ?? [];
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
}

/**
 * Create a project and, in the same synchronous transaction, seed its default
 * roles and add the creator as a "Project Manager" member. `code` is
 * auto-generated from the short id when not supplied. bun:sqlite transactions
 * are synchronous — keep the callback sync so COMMIT/ROLLBACK semantics hold.
 */
export async function createProject(db: AppDatabase, input: CreateProjectInput): Promise<ProjectRow> {
  const id = ulid();
  const shortId = nanoid();
  const code = input.code ?? `P-${shortId.toUpperCase()}`;
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(projects).values({
      id,
      shortId,
      code,
      name: input.name,
      status: input.status ?? "active",
      description: input.description ?? null,
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

    if (input.tags && input.tags.length > 0)
      syncTagsTx(tx, id, input.tags, now);
  });

  return (await db.select().from(projects).where(eq(projects.id, id)).get())!;
}

export async function getProjectByShortId(db: AppDatabase, shortId: string): Promise<ProjectRow | undefined> {
  return await db.select().from(projects).where(
    and(eq(projects.shortId, shortId), isNull(projects.deletedAt)),
  ).get();
}

/** Compose a single project view with its tags loaded. */
export async function composeProjectWithTags(db: AppDatabase, row: ProjectRow): Promise<ProjectView> {
  return composeProject(row, await loadTagsForProject(db, row.id));
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
  const data = rows.map(r => composeProject(r, tagMap.get(r.id) ?? []));

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
