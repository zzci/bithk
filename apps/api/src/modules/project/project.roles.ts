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
  readonly kind: "owner" | "guest" | null;
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
    kind: row.kind ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitize(caps: readonly string[]): ProjectCapability[] {
  return caps.filter((c): c is ProjectCapability => CAPABILITY_SET.has(c));
}

// ─── Seeding ────────────────────────────────────────────────────────────
// Run inside the createProject transaction. Seeds five roles:
//   Owner  (isSystem=1, kind='owner') — all 12 caps; creator gets this role.
//   Guest  (isSystem=1, kind='guest') — no caps; delete-fallback target.
//   Reader     (isSystem=0, kind=null) — issue.view + procurement.view + files.view
//   Commenter  (isSystem=0, kind=null) — Reader + issue.comment + procurement.comment
//   Writer     (isSystem=0, kind=null) — Commenter + issue.manage + procurement.manage
//                                         + files.manage + categories.manage
export interface SeededRoles {
  /** The Owner role id; the project creator is added with this role. */
  readonly ownerRoleId: string;
  /** The Guest role id; used as the delete-fallback target. */
  readonly guestRoleId: string;
  /** The Reader preset role id. */
  readonly readerRoleId: string;
}

const READER_CAPS: readonly ProjectCapability[] = ["issue.view", "procurement.view", "files.view"];
const COMMENTER_CAPS: readonly ProjectCapability[] = [...READER_CAPS, "issue.comment", "procurement.comment"];
const WRITER_CAPS: readonly ProjectCapability[] = [...COMMENTER_CAPS, "issue.manage", "procurement.manage", "files.manage", "categories.manage"];

export function seedDefaultRoles(tx: AppTransaction, projectId: string, now: string): SeededRoles {
  const ownerRoleId = nanoid();
  const guestRoleId = nanoid();
  const readerRoleId = nanoid();
  const commenterRoleId = nanoid();
  const writerRoleId = nanoid();
  tx.insert(projectRoles).values([
    {
      id: ownerRoleId,
      projectId,
      name: "Project Owner",
      capabilities: JSON.stringify([...PROJECT_CAPABILITIES]),
      isSystem: 1,
      kind: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: guestRoleId,
      projectId,
      name: "Guest",
      capabilities: "[]",
      isSystem: 1,
      kind: "guest",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: readerRoleId,
      projectId,
      name: "Reader",
      capabilities: JSON.stringify([...READER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: commenterRoleId,
      projectId,
      name: "Commenter",
      capabilities: JSON.stringify([...COMMENTER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: writerRoleId,
      projectId,
      name: "Writer",
      capabilities: JSON.stringify([...WRITER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
  ]).run();
  return { ownerRoleId, guestRoleId, readerRoleId };
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

/**
 * Resolve the Guest (kind='guest') role for a project.
 * Guest is guaranteed to exist (seeded at project creation; backfilled by migration).
 */
export async function resolveGuestRole(db: AppDatabase, projectId: string): Promise<ProjectRoleRow | undefined> {
  return await db.select().from(projectRoles).where(
    and(eq(projectRoles.projectId, projectId), eq(projectRoles.kind, "guest")),
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
    kind: null,
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

export type DeleteRoleResult = "deleted" | "not_found" | "system";

/**
 * Delete a custom role. Refuses system roles (isSystem=1).
 * For custom roles: in one transaction, reassigns every holder to the project's
 * Guest role, then deletes the role. Returns "deleted".
 */
export async function deleteRole(db: AppDatabase, projectId: string, roleId: string): Promise<DeleteRoleResult> {
  const existing = await resolveRole(db, projectId, roleId);
  if (!existing)
    return "not_found";
  if (existing.isSystem === 1)
    return "system";

  const guest = await resolveGuestRole(db, projectId);
  // Guest is guaranteed to exist; if somehow missing, fallback: just delete the role.
  db.transaction((tx) => {
    if (guest) {
      tx.update(projectMembers)
        .set({ roleId: guest.id })
        .where(eq(projectMembers.roleId, roleId))
        .run();
    }
    tx.delete(projectRoles).where(eq(projectRoles.id, roleId)).run();
  });
  return "deleted";
}
