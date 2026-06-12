import type { AppDatabase } from "@/db";
import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { groups } from "@/modules/account/groups/schema";
import { users } from "@/modules/account/users/schema";
import {
  listGroupMembershipsForUser,
  listGroupMembershipsForUsers,
  listUserIdsInGroup,
} from "@/modules/policy/policy.service";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";

type UserRole = "admin" | "user";
type UserStatus = "active" | "disabled";

const userColumns = {
  id: users.id,
  username: users.username,
  name: users.name,
  email: users.email,
  avatar: users.avatar,
  role: users.role,
  status: users.status,
  isVirtual: users.isVirtual,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

interface ListUsersParams {
  readonly q?: string | undefined;
  readonly role?: UserRole | undefined;
  readonly status?: UserStatus | undefined;
  readonly groupId?: string | undefined;
  readonly page: number;
  readonly limit: number;
}

export async function listUsers(db: AppDatabase, params: ListUsersParams) {
  const { q, role, status, groupId, page, limit } = params;
  const offset = (page - 1) * limit;
  const conditions = [];

  if (q) {
    // SQLite LIKE has no default escape character, so escape the term's
    // backslash + wildcard literals and bind an explicit ESCAPE clause.
    // Without this, a query containing `%` or `_` would over-match (the
    // user's wildcards leak through) and a backslash would match literally.
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      sql`${users.name} LIKE ${pattern} ESCAPE '\\'`,
      sql`${users.email} LIKE ${pattern} ESCAPE '\\'`,
      sql`${users.username} LIKE ${pattern} ESCAPE '\\'`,
    ));
  }
  if (role) {
    conditions.push(eq(users.role, role));
  }
  if (status) {
    conditions.push(eq(users.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (groupId) {
    const memberIds = await listUserIdsInGroup(db, groupId);
    if (memberIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const groupWhere = where
      ? and(where, inArray(users.id, [...memberIds]))
      : inArray(users.id, [...memberIds]);

    const totalResult = await db
      .select({ count: count() })
      .from(users)
      .where(groupWhere)
      .get();
    const total = totalResult?.count ?? 0;

    const data = await db
      .select(userColumns)
      .from(users)
      .where(groupWhere)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(limit)
      .offset(offset)
      .all();

    const dataWithGroups = await attachUserGroups(db, data);
    return { data: dataWithGroups, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  const totalResult = await db.select({ count: count() }).from(users).where(where).get();
  const total = totalResult?.count ?? 0;

  const data = await db
    .select(userColumns)
    .from(users)
    .where(where)
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(limit)
    .offset(offset)
    .all();

  const dataWithGroups = await attachUserGroups(db, data);
  return { data: dataWithGroups, total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function attachUserGroups<T extends { id: string }>(db: AppDatabase, data: T[]) {
  const userIds = data.map(u => u.id);
  if (userIds.length === 0)
    return data.map(u => ({ ...u, groups: [] as Array<{ id: string; name: string }> }));

  const memberships = await listGroupMembershipsForUsers(db, userIds);
  if (memberships.length === 0)
    return data.map(u => ({ ...u, groups: [] as Array<{ id: string; name: string }> }));

  const groupIds = [...new Set(memberships.map(m => m.groupId))];
  const groupRows = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(inArray(groups.id, groupIds))
    .all();
  const groupMap = new Map(groupRows.map(g => [g.id, g.name]));

  const groupsByUser = new Map<string, Array<{ id: string; name: string }>>();
  for (const m of memberships) {
    const name = groupMap.get(m.groupId);
    if (!name)
      continue;
    const list = groupsByUser.get(m.userId) ?? [];
    list.push({ id: m.groupId, name });
    groupsByUser.set(m.userId, list);
  }

  return data.map(u => ({ ...u, groups: groupsByUser.get(u.id) ?? [] }));
}

export async function getUserById(db: AppDatabase, id: string) {
  return await db.select(userColumns).from(users).where(eq(users.id, id)).get();
}

/**
 * Last-admin guard (FEAT-031): throws 409 when `targetId` is the only active
 * admin left. Single requests cannot reach this state (self-edit is blocked,
 * disabled admins cannot authenticate, and the caller is itself an active
 * admin), so the guard's real job is the concurrent mutual-demotion race —
 * call it INSIDE the demoting transaction so the second writer sees the
 * first's committed demotion and rolls back.
 */
export function assertNotLastActiveAdmin(db: Pick<AppDatabase, "select">, targetId: string): void {
  const others = db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, targetId)))
    .get();
  if ((others?.value ?? 0) === 0) {
    throw new AppError("Cannot demote or disable the last active admin", 409, "LAST_ADMIN");
  }
}

export async function updateUser(db: AppDatabase, id: string, data: { role?: UserRole | undefined; status?: UserStatus | undefined }) {
  const now = new Date().toISOString();
  const setData: Record<string, unknown> = { updatedAt: now };
  if (data.role !== undefined)
    setData.role = data.role;
  if (data.status !== undefined)
    setData.status = data.status;
  await db.update(users)
    .set(setData)
    .where(eq(users.id, id))
    .run();
  return await db.select(userColumns).from(users).where(eq(users.id, id)).get();
}

export async function getUserGroups(db: AppDatabase, userId: string) {
  const memberships = await listGroupMembershipsForUser(db, userId);
  if (memberships.length === 0)
    return [];

  const groupIds = memberships.map(m => m.groupId);
  const joinedAtMap = new Map(memberships.map(m => [m.groupId, m.joinedAt]));

  const groupRows = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      createdAt: groups.createdAt,
    })
    .from(groups)
    .where(inArray(groups.id, groupIds))
    .all();

  return groupRows.map(g => ({
    ...g,
    joinedAt: joinedAtMap.get(g.id) ?? "",
  }));
}

/**
 * Active REAL users only. Backs the sharing / comment / assignment pickers that
 * must never surface virtual users (they have no login identity), so the filter
 * excludes `isVirtual` rows.
 */
export async function listActiveUsers(db: AppDatabase) {
  return await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.isVirtual, false)))
    .orderBy(users.name)
    .all();
}

/**
 * Active real AND virtual users — the source for the project member-add picker.
 * Virtual users are assignable operators, so they belong here even though they
 * are hidden from {@link listActiveUsers}.
 */
export async function listAssignableUsers(db: AppDatabase) {
  return await db
    .select({ id: users.id, name: users.name, username: users.username, isVirtual: users.isVirtual })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(users.name)
    .all();
}

/**
 * Create a virtual user: a first-class `users` row without a login identity.
 * Username uniqueness is enforced GLOBALLY (against real and virtual users)
 * before the insert so the collision surfaces as a clean 409, not a raw
 * unique-constraint 500.
 */
export async function createVirtualUser(db: AppDatabase, input: { username: string; name: string }) {
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get();
  if (taken)
    throw new AppError("Username already taken", 409, "CONFLICT");

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `virtual:${id}`,
    username: input.username,
    name: input.name,
    email: `${input.username}@virtual.local`,
    role: "user",
    status: "active",
    isVirtual: true,
    createdAt: now,
    updatedAt: now,
  }).run();
  return await db.select(userColumns).from(users).where(eq(users.id, id)).get();
}

/**
 * Update a virtual user's display fields. Rejects a rename that collides with
 * any existing username (real or virtual), self excluded. Callers must ensure
 * the target is virtual; renaming real users is not supported.
 */
export async function updateVirtualUser(db: AppDatabase, id: string, data: { name?: string | undefined; username?: string | undefined }) {
  if (data.username !== undefined) {
    const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, data.username)).get();
    if (taken && taken.id !== id)
      throw new AppError("Username already taken", 409, "CONFLICT");
  }
  const now = new Date().toISOString();
  const setData: Record<string, unknown> = { updatedAt: now };
  if (data.name !== undefined)
    setData.name = data.name;
  if (data.username !== undefined)
    setData.username = data.username;
  await db.update(users).set(setData).where(eq(users.id, id)).run();
  return await db.select(userColumns).from(users).where(eq(users.id, id)).get();
}

/**
 * Hard-delete a virtual user. Real users cannot be deleted here (they own
 * sessions / OAuth identity). `project_members.userId` cascades on delete, so
 * the user's memberships drop with the row.
 */
export async function deleteVirtualUser(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await db.select({ id: users.id, isVirtual: users.isVirtual }).from(users).where(eq(users.id, id)).get();
  if (!existing)
    throw new NotFoundError("User", id);
  if (!existing.isVirtual)
    throw new AppError("Only virtual users can be deleted", 409, "CONFLICT");
  await db.delete(users).where(eq(users.id, id)).run();
  return true;
}
