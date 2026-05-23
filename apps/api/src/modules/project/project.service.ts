import type { MemberRole, MemberType, ProjectStatus } from "./schema";
import type { AppDatabase } from "@/db";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid, ulid } from "@/shared/lib/id";
import { projectMembers, projects } from "./schema";

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;

// ─── External views ───────────────────────────────────────────────────────
// Routes return these instead of raw rows: `shortId` is the sole external
// project identifier, so the internal ULID (`projects.id`) and the soft-delete
// marker never leave the API. Member rows expose their own nanoid `id` (the
// canonical assignment target) but drop the redundant internal `projectId`.

export interface ProjectView {
  readonly id: string; // project short_id
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly description: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProjectMemberView {
  readonly id: string; // project_members nanoid — external assignment target
  readonly memberType: MemberType;
  readonly role: MemberRole;
  readonly userId: string | null;
  readonly displayName: string | null;
  readonly externalRef: string | null;
  readonly supplierInfo: string | null;
  readonly canViewProcurement: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeProject(row: ProjectRow): ProjectView {
  return {
    id: row.shortId,
    code: row.code,
    name: row.name,
    status: row.status,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    creatorId: row.creatorId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export function composeMember(row: ProjectMemberRow): ProjectMemberView {
  return {
    id: row.id,
    memberType: row.memberType,
    role: row.role,
    userId: row.userId,
    displayName: row.displayName,
    externalRef: row.externalRef,
    supplierInfo: row.supplierInfo,
    canViewProcurement: row.canViewProcurement,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Project CRUD ───────────────────────────────────────────────────────

export interface CreateProjectInput {
  readonly code?: string | undefined;
  readonly name: string;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly creatorId: string;
}

/**
 * Create a project row and, in the same synchronous transaction, the creator
 * as a `pm` `internal` member. `code` is auto-generated from the short id when
 * not supplied. bun:sqlite transactions are synchronous — keep them sync so
 * COMMIT/ROLLBACK semantics hold.
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
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      creatorId: input.creatorId,
      version: 1,
      deletedAt: null,
      updatedAt: now,
    }).run();

    tx.insert(projectMembers).values({
      id: nanoid(),
      projectId: id,
      memberType: "internal",
      role: "pm",
      userId: input.creatorId,
      displayName: null,
      externalRef: null,
      supplierInfo: null,
      canViewProcurement: 1,
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  return (await db.select().from(projects).where(eq(projects.id, id)).get())!;
}

export async function getProjectByShortId(db: AppDatabase, shortId: string): Promise<ProjectRow | undefined> {
  return await db.select().from(projects).where(
    and(eq(projects.shortId, shortId), isNull(projects.deletedAt)),
  ).get();
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
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  // When set (non-admin callers), restrict the list to projects this user is a
  // member of. Omit for admins, who see every project. Read = member, so the
  // global list must not leak projects the caller has no membership in.
  readonly memberUserId?: string | undefined;
}

export interface ListProjectResult {
  readonly data: readonly ProjectRow[];
  readonly total: number;
}

export async function listProjects(db: AppDatabase, params: ListProjectParams = {}): Promise<ListProjectResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const conditions = [isNull(projects.deletedAt)];
  if (params.status)
    conditions.push(eq(projects.status, params.status));
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

  const data = await db.select().from(projects).where(where).orderBy(desc(projects.id)).limit(limit).offset((page - 1) * limit).all();

  return { data, total };
}

export interface UpdateProjectInput {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly status?: ProjectStatus | undefined;
  readonly description?: string | null | undefined;
  readonly startDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
}

export async function updateProject(db: AppDatabase, shortId: string, input: UpdateProjectInput): Promise<ProjectRow | undefined> {
  const project = await getProjectByShortId(db, shortId);
  if (!project)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now, version: sql`${projects.version} + 1` };
  if (input.code !== undefined)
    patch.code = input.code;
  if (input.name !== undefined)
    patch.name = input.name;
  if (input.status !== undefined)
    patch.status = input.status;
  if (input.description !== undefined)
    patch.description = input.description;
  if (input.startDate !== undefined)
    patch.startDate = input.startDate;
  if (input.endDate !== undefined)
    patch.endDate = input.endDate;

  await db.update(projects).set(patch).where(eq(projects.id, project.id)).run();
  return await db.select().from(projects).where(eq(projects.id, project.id)).get();
}

/**
 * Soft-delete a project (stamp `deleted_at`). Projects are NOT hard-deleted,
 * so the FK ON DELETE CASCADE on `project_members` / detail rows does NOT
 * fire here — members and downstream rows stay intact and are simply hidden
 * because every read filters on `deleted_at IS NULL`. Cascade only applies if
 * the row is ever physically deleted (e.g. a user account removal cascading
 * through `creator_id`).
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
  readonly memberType: MemberType;
  readonly role?: MemberRole | undefined;
  readonly userId?: string | null | undefined;
  readonly displayName?: string | null | undefined;
  readonly externalRef?: string | null | undefined;
  readonly supplierInfo?: string | null | undefined;
  readonly canViewProcurement?: boolean | undefined;
}

export async function addMember(db: AppDatabase, projectId: string, input: AddMemberInput): Promise<ProjectMemberRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(projectMembers).values({
    id,
    projectId,
    memberType: input.memberType,
    role: input.role ?? "member",
    userId: input.memberType === "internal" ? (input.userId ?? null) : null,
    displayName: input.displayName ?? null,
    externalRef: input.externalRef ?? null,
    supplierInfo: input.supplierInfo ?? null,
    canViewProcurement: input.canViewProcurement ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(projectMembers).where(eq(projectMembers.id, id)).get())!;
}

export async function listMembers(db: AppDatabase, projectId: string): Promise<readonly ProjectMemberRow[]> {
  return await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(desc(projectMembers.createdAt)).all();
}

export interface UpdateMemberInput {
  readonly role?: MemberRole | undefined;
  readonly canViewProcurement?: boolean | undefined;
  readonly displayName?: string | null | undefined;
  readonly externalRef?: string | null | undefined;
  readonly supplierInfo?: string | null | undefined;
  /** Promote an external member to internal by attaching a real user id. */
  readonly userId?: string | null | undefined;
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
  if (input.role !== undefined)
    patch.role = input.role;
  if (input.canViewProcurement !== undefined)
    patch.canViewProcurement = input.canViewProcurement ? 1 : 0;
  if (input.displayName !== undefined)
    patch.displayName = input.displayName;
  if (input.externalRef !== undefined)
    patch.externalRef = input.externalRef;
  if (input.supplierInfo !== undefined)
    patch.supplierInfo = input.supplierInfo;
  // Promote external → internal: attaching a user id flips the member type.
  if (input.userId !== undefined && input.userId !== null) {
    patch.userId = input.userId;
    patch.memberType = "internal";
  }

  await db.update(projectMembers).set(patch).where(eq(projectMembers.id, memberId)).run();
  return await db.select().from(projectMembers).where(eq(projectMembers.id, memberId)).get();
}

export async function removeMember(db: AppDatabase, projectId: string, memberId: string): Promise<boolean> {
  const result = await db.delete(projectMembers)
    .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
    .run() as unknown as { changes: number };
  return result.changes > 0;
}

// ─── Public contract (consumed by issue / procurement modules) ────────────

/** True when `userId` holds any member row on the project. */
export async function isMember(db: AppDatabase, projectId: string, userId: string): Promise<boolean> {
  const row = await db.select({ id: projectMembers.id }).from(projectMembers).where(
    and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  ).get();
  return !!row;
}

/** Resolve the user's role on a project, or `null` when they are not a member. */
export async function getRole(db: AppDatabase, projectId: string, userId: string): Promise<MemberRole | null> {
  const row = await db.select({ role: projectMembers.role }).from(projectMembers).where(
    and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  ).get();
  return row?.role ?? null;
}

/** True when the user is a pm OR their member row carries `can_view_procurement`. */
export async function canViewProcurement(db: AppDatabase, projectId: string, userId: string): Promise<boolean> {
  const row = await db.select({ role: projectMembers.role, canView: projectMembers.canViewProcurement }).from(projectMembers).where(
    and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
  ).get();
  if (!row)
    return false;
  return row.role === "pm" || row.canView === 1;
}

export interface AssignableMember {
  readonly id: string;
  readonly memberType: MemberType;
  readonly userId: string | null;
}

/**
 * Validate that a `project_members.id` belongs to the given project and return
 * its assignment-relevant fields. Used by issue / procurement to validate an
 * assignment target. Returns `null` when the member does not belong here.
 */
export async function resolveAssignableMember(
  db: AppDatabase,
  projectId: string,
  memberId: string,
): Promise<AssignableMember | null> {
  const row = await db.select({
    id: projectMembers.id,
    memberType: projectMembers.memberType,
    userId: projectMembers.userId,
  }).from(projectMembers).where(
    and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)),
  ).get();
  return row ?? null;
}
