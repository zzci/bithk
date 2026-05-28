import type { ProjectCapability } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { PROJECT_CAPABILITIES, projectMembers, projectRoles } from "./schema";

export type ProjectRoleRow = typeof projectRoles.$inferSelect;

export interface ProjectRoleView {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ProjectCapability[];
  readonly isSystem: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const CAPABILITY_SET = new Set<string>(PROJECT_CAPABILITIES);

/** Parse the stored JSON capability list, dropping anything unknown. */
export function parseCapabilities(raw: string): ProjectCapability[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((c): c is ProjectCapability => typeof c === "string" && CAPABILITY_SET.has(c));
  }
  catch {
    return [];
  }
}

export function composeRole(row: ProjectRoleRow): ProjectRoleView {
  return {
    id: row.id,
    name: row.name,
    capabilities: parseCapabilities(row.capabilities),
    isSystem: row.isSystem === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitize(caps: readonly string[]): ProjectCapability[] {
  return caps.filter((c): c is ProjectCapability => CAPABILITY_SET.has(c));
}

// ─── Seeding ────────────────────────────────────────────────────────────
// Run inside the createProject transaction. Seeds one undeletable, all-powerful
// "Project Owner" role (the creator gets it) and a baseline "Member" role.
export interface SeededRoles {
  readonly pmRoleId: string;
  readonly memberRoleId: string;
}

export function seedDefaultRoles(tx: AppTransaction, projectId: string, now: string): SeededRoles {
  const pmRoleId = nanoid();
  const memberRoleId = nanoid();
  tx.insert(projectRoles).values([
    {
      id: pmRoleId,
      projectId,
      name: "Project Owner",
      capabilities: JSON.stringify([...PROJECT_CAPABILITIES]),
      isSystem: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: memberRoleId,
      projectId,
      name: "Member",
      capabilities: "[]",
      isSystem: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]).run();
  return { pmRoleId, memberRoleId };
}

// ─── CRUD ─────────────────────────────────────────────────────────────
export async function listRoles(db: AppDatabase, projectId: string): Promise<readonly ProjectRoleRow[]> {
  return await db.select().from(projectRoles).where(eq(projectRoles.projectId, projectId)).all();
}

export async function resolveRole(db: AppDatabase, projectId: string, roleId: string): Promise<ProjectRoleRow | undefined> {
  return await db.select().from(projectRoles).where(
    and(eq(projectRoles.id, roleId), eq(projectRoles.projectId, projectId)),
  ).get();
}

export interface CreateRoleInput {
  readonly name: string;
  readonly capabilities?: readonly string[] | undefined;
}

export async function createRole(db: AppDatabase, projectId: string, input: CreateRoleInput): Promise<ProjectRoleRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(projectRoles).values({
    id,
    projectId,
    name: input.name,
    capabilities: JSON.stringify(sanitize(input.capabilities ?? [])),
    isSystem: 0,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(projectRoles).where(eq(projectRoles.id, id)).get())!;
}

export interface UpdateRoleInput {
  readonly name?: string | undefined;
  readonly capabilities?: readonly string[] | undefined;
}

export async function updateRole(
  db: AppDatabase,
  projectId: string,
  roleId: string,
  input: UpdateRoleInput,
): Promise<ProjectRoleRow | undefined> {
  const existing = await resolveRole(db, projectId, roleId);
  if (!existing)
    return undefined;
  // System role capabilities are locked to the full set; only allow no-op edits.
  if (existing.isSystem === 1)
    return existing;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.name !== undefined)
    patch.name = input.name;
  if (input.capabilities !== undefined)
    patch.capabilities = JSON.stringify(sanitize(input.capabilities));
  await db.update(projectRoles).set(patch).where(eq(projectRoles.id, roleId)).run();
  return await db.select().from(projectRoles).where(eq(projectRoles.id, roleId)).get();
}

export type DeleteRoleResult = "deleted" | "not_found" | "system" | "in_use";

/** Delete a role. Refuses system roles and roles still held by a member. */
export async function deleteRole(db: AppDatabase, projectId: string, roleId: string): Promise<DeleteRoleResult> {
  const existing = await resolveRole(db, projectId, roleId);
  if (!existing)
    return "not_found";
  if (existing.isSystem === 1)
    return "system";
  const inUse = await db.select({ id: projectMembers.id }).from(projectMembers).where(eq(projectMembers.roleId, roleId)).get();
  if (inUse)
    return "in_use";
  await db.delete(projectRoles).where(eq(projectRoles.id, roleId)).run();
  return "deleted";
}
