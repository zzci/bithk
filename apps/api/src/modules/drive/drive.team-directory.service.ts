import type { TeamDirectoryRole } from "./schema";
import type { AppDatabase } from "@/db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { AppError, ForbiddenError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { driveEntries, teamDirectories, teamDirectoryMembers } from "./schema";

export type TeamDirectoryRow = typeof teamDirectories.$inferSelect;
export type TeamDirectoryMemberRow = typeof teamDirectoryMembers.$inferSelect;

export interface TeamDirectoryView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Effective role of the requesting user (creator is always admin). */
  readonly role: TeamDirectoryRole;
  readonly memberCount: number;
}

/**
 * Resolve the requesting user's effective role on a directory. The creator
 * is implicitly `admin`; everyone else gets their explicit member role, or
 * `null` when they are not a member.
 */
export async function getDirectoryRole(
  db: AppDatabase,
  directoryId: string,
  userId: string,
): Promise<TeamDirectoryRole | null> {
  const dir = await db
    .select({ createdBy: teamDirectories.createdBy })
    .from(teamDirectories)
    .where(eq(teamDirectories.id, directoryId))
    .get();
  if (!dir)
    return null;
  if (dir.createdBy === userId)
    return "admin";

  const member = await db
    .select({ role: teamDirectoryMembers.role })
    .from(teamDirectoryMembers)
    .where(and(
      eq(teamDirectoryMembers.directoryId, directoryId),
      eq(teamDirectoryMembers.userId, userId),
    ))
    .get();
  return member?.role ?? null;
}

async function requireDirectory(db: AppDatabase, directoryId: string): Promise<TeamDirectoryRow> {
  const dir = await db.select().from(teamDirectories).where(eq(teamDirectories.id, directoryId)).get();
  if (!dir)
    throw new NotFoundError("Team directory", directoryId);
  return dir;
}

async function assertAdmin(db: AppDatabase, directoryId: string, userId: string): Promise<void> {
  const role = await getDirectoryRole(db, directoryId, userId);
  if (role !== "admin")
    throw new ForbiddenError("Admin access required for this team directory");
}

/** Directories the user owns or is a member of, with member counts. */
export async function listTeamDirectories(db: AppDatabase, userId: string): Promise<readonly TeamDirectoryView[]> {
  const owned = await db.select().from(teamDirectories).where(eq(teamDirectories.createdBy, userId)).all();
  const member = await db
    .select({ directory: teamDirectories, role: teamDirectoryMembers.role })
    .from(teamDirectoryMembers)
    .innerJoin(teamDirectories, eq(teamDirectoryMembers.directoryId, teamDirectories.id))
    .where(eq(teamDirectoryMembers.userId, userId))
    .all();

  const ownedIds = new Set(owned.map(d => d.id));
  const combined: Array<{ dir: TeamDirectoryRow; role: TeamDirectoryRole }> = [
    ...owned.map(dir => ({ dir, role: "admin" as const })),
    ...member.filter(row => !ownedIds.has(row.directory.id)).map(row => ({ dir: row.directory, role: row.role })),
  ];

  const ids = combined.map(c => c.dir.id);
  const counts = ids.length > 0
    ? await db
        .select({ directoryId: teamDirectoryMembers.directoryId, total: count() })
        .from(teamDirectoryMembers)
        .where(inArray(teamDirectoryMembers.directoryId, ids))
        .groupBy(teamDirectoryMembers.directoryId)
        .all()
    : [];
  const countMap = new Map(counts.map(c => [c.directoryId, c.total]));

  return combined.map(({ dir, role }) => composeDirectoryView(dir, role, countMap.get(dir.id) ?? 0));
}

export interface CreateTeamDirectoryInput {
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly createdBy: string;
}

export async function createTeamDirectory(db: AppDatabase, input: CreateTeamDirectoryInput): Promise<TeamDirectoryView> {
  const name = input.name.trim();
  if (!name)
    throw new AppError("Team directory name is required", 400, "VALIDATION_ERROR");

  const id = nanoid();
  await db.insert(teamDirectories).values({
    id,
    name,
    description: input.description ?? null,
    createdBy: input.createdBy,
  }).run();

  const dir = await requireDirectory(db, id);
  return composeDirectoryView(dir, "admin", 0);
}

export async function getTeamDirectory(db: AppDatabase, directoryId: string, userId: string): Promise<TeamDirectoryView> {
  const role = await getDirectoryRole(db, directoryId, userId);
  if (role === null)
    throw new ForbiddenError("You do not have access to this team directory");
  const dir = await requireDirectory(db, directoryId);
  const total = await db
    .select({ value: count() })
    .from(teamDirectoryMembers)
    .where(eq(teamDirectoryMembers.directoryId, directoryId))
    .get();
  return composeDirectoryView(dir, role, total?.value ?? 0);
}

export interface UpdateTeamDirectoryInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
}

export async function updateTeamDirectory(
  db: AppDatabase,
  directoryId: string,
  userId: string,
  input: UpdateTeamDirectoryInput,
): Promise<TeamDirectoryView> {
  await assertAdmin(db, directoryId, userId);
  const patch: Partial<typeof teamDirectories.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name)
      throw new AppError("Team directory name is required", 400, "VALIDATION_ERROR");
    patch.name = name;
  }
  if (input.description !== undefined)
    patch.description = input.description ?? null;

  await db.update(teamDirectories).set(patch).where(eq(teamDirectories.id, directoryId)).run();
  return getTeamDirectory(db, directoryId, userId);
}

/** Only the creator may delete, and only when the directory holds no entries. */
export async function deleteTeamDirectory(db: AppDatabase, directoryId: string, userId: string): Promise<void> {
  const dir = await requireDirectory(db, directoryId);
  if (dir.createdBy !== userId)
    throw new ForbiddenError("Only the creator can delete a team directory");

  const entries = await db
    .select({ value: count() })
    .from(driveEntries)
    .where(and(eq(driveEntries.ownerType, "team_directory"), eq(driveEntries.ownerId, directoryId)))
    .get();
  if ((entries?.value ?? 0) > 0)
    throw new AppError("Cannot delete a team directory that still contains entries", 409, "DIRECTORY_NOT_EMPTY");

  // members cascade via the FK, but delete explicitly so the row count is
  // deterministic regardless of PRAGMA foreign_keys state.
  await db.delete(teamDirectoryMembers).where(eq(teamDirectoryMembers.directoryId, directoryId)).run();
  await db.delete(teamDirectories).where(eq(teamDirectories.id, directoryId)).run();
}

// ─── Members ──────────────────────────────────────────────────────────────

export async function listTeamMembers(db: AppDatabase, directoryId: string, userId: string): Promise<readonly TeamDirectoryMemberRow[]> {
  const role = await getDirectoryRole(db, directoryId, userId);
  if (role === null)
    throw new ForbiddenError("You do not have access to this team directory");
  return db
    .select()
    .from(teamDirectoryMembers)
    .where(eq(teamDirectoryMembers.directoryId, directoryId))
    .orderBy(desc(teamDirectoryMembers.createdAt))
    .all();
}

export interface AddTeamMemberInput {
  readonly userId: string;
  readonly role?: TeamDirectoryRole | undefined;
}

export async function addTeamMember(
  db: AppDatabase,
  directoryId: string,
  actorId: string,
  input: AddTeamMemberInput,
): Promise<TeamDirectoryMemberRow> {
  const dir = await requireDirectory(db, directoryId);
  await assertAdmin(db, directoryId, actorId);
  if (input.userId === dir.createdBy)
    throw new AppError("The directory creator is always an admin", 409, "VALIDATION_ERROR");

  const role = input.role ?? "viewer";
  const existing = await db
    .select()
    .from(teamDirectoryMembers)
    .where(and(eq(teamDirectoryMembers.directoryId, directoryId), eq(teamDirectoryMembers.userId, input.userId)))
    .get();

  if (existing) {
    await db.update(teamDirectoryMembers).set({ role }).where(eq(teamDirectoryMembers.id, existing.id)).run();
    return db.select().from(teamDirectoryMembers).where(eq(teamDirectoryMembers.id, existing.id)).get()!;
  }

  const id = nanoid();
  await db.insert(teamDirectoryMembers).values({ id, directoryId, userId: input.userId, role }).run();
  return db.select().from(teamDirectoryMembers).where(eq(teamDirectoryMembers.id, id)).get()!;
}

export async function updateTeamMember(
  db: AppDatabase,
  directoryId: string,
  memberId: string,
  actorId: string,
  role: TeamDirectoryRole,
): Promise<TeamDirectoryMemberRow> {
  await requireDirectory(db, directoryId);
  await assertAdmin(db, directoryId, actorId);
  const existing = await db
    .select()
    .from(teamDirectoryMembers)
    .where(and(eq(teamDirectoryMembers.id, memberId), eq(teamDirectoryMembers.directoryId, directoryId)))
    .get();
  if (!existing)
    throw new NotFoundError("Team member", memberId);

  await db.update(teamDirectoryMembers).set({ role }).where(eq(teamDirectoryMembers.id, memberId)).run();
  return db.select().from(teamDirectoryMembers).where(eq(teamDirectoryMembers.id, memberId)).get()!;
}

export async function removeTeamMember(db: AppDatabase, directoryId: string, memberId: string, actorId: string): Promise<void> {
  await requireDirectory(db, directoryId);
  await assertAdmin(db, directoryId, actorId);
  const existing = await db
    .select({ id: teamDirectoryMembers.id })
    .from(teamDirectoryMembers)
    .where(and(eq(teamDirectoryMembers.id, memberId), eq(teamDirectoryMembers.directoryId, directoryId)))
    .get();
  if (!existing)
    throw new NotFoundError("Team member", memberId);

  await db.delete(teamDirectoryMembers).where(eq(teamDirectoryMembers.id, memberId)).run();
}

function composeDirectoryView(dir: TeamDirectoryRow, role: TeamDirectoryRole, memberCount: number): TeamDirectoryView {
  return {
    id: dir.id,
    name: dir.name,
    description: dir.description,
    createdBy: dir.createdBy,
    createdAt: dir.createdAt,
    updatedAt: dir.updatedAt,
    role,
    memberCount,
  };
}
