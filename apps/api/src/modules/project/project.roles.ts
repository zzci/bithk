import type { ProjectCapability } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, eq } from "drizzle-orm";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { PROJECT_CAPABILITIES, projectMembers, projectRoles, projects } from "./schema";

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

export const READER_CAPS: readonly ProjectCapability[] = ["issue.view", "procurement.view", "files.view"];
export const COMMENTER_CAPS: readonly ProjectCapability[] = [...READER_CAPS, "issue.comment", "procurement.comment"];
export const WRITER_CAPS: readonly ProjectCapability[] = [...COMMENTER_CAPS, "issue.manage", "procurement.manage", "files.manage", "categories.manage"];

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
  if (!guest) {
    // Guest is always seeded (createProject + boot-time backfill), so this only
    // triggers on a corrupted project. We cannot reassign holders without it,
    // and `project_members.role_id` is ON DELETE RESTRICT, so deleting a held
    // role would raise a raw FK error. Degrade cleanly: block with a clear
    // ValidationError when any member still holds the role; otherwise the
    // unheld role is safe to delete directly.
    const holder = await db.select({ id: projectMembers.id })
      .from(projectMembers)
      .where(eq(projectMembers.roleId, roleId))
      .get();
    if (holder) {
      throw new ValidationError("Cannot delete role", {
        role: "The project has no Guest role to reassign members to",
      });
    }
    await db.delete(projectRoles).where(eq(projectRoles.id, roleId)).run();
    return "deleted";
  }

  // In one transaction, reassign every holder to Guest, then delete the role.
  db.transaction((tx) => {
    tx.update(projectMembers)
      .set({ roleId: guest.id })
      .where(eq(projectMembers.roleId, roleId))
      .run();
    tx.delete(projectRoles).where(eq(projectRoles.id, roleId)).run();
  });
  return "deleted";
}

// ─── Boot-time backfill ─────────────────────────────────────────────────────
//
// Self-healing idempotent: safe to call on every server boot. Each project is
// processed on every run; each step within a project is individually idempotent.
// A fully-correct project contributes 0 to projectsTouched and 0 to rolesInserted.
//
// Per-project mutations (in a single transaction each):
//   1. Owner: identify the owner role (kind='owner' OR isSystem=1 AND kind IS NULL).
//      Always UPDATE to kind='owner' and the full 12-cap PROJECT_CAPABILITIES set.
//      Count as "touched" only when kind or capabilities actually changed.
//   2. Guest: insert kind='guest' isSystem=1 role only if none exists.
//   3. Member→Reader: rename the "Member" role (isSystem=0, kind=null) to "Reader"
//      and set its caps to READER_CAPS, preserving its row id so existing member
//      assignments remain valid. Idempotent — no "Member" row after rename.
//   4. Presets: insert any missing Reader/Commenter/Writer by name among isSystem=0
//      roles, accounting for any just-renamed Reader from step 3.

export interface BackfillResult {
  readonly projectsScanned: number;
  readonly projectsTouched: number;
  readonly rolesInserted: number;
}

const FULL_CAPS_JSON = JSON.stringify([...PROJECT_CAPABILITIES]);

export async function backfillProjectRoles(db: AppDatabase): Promise<BackfillResult> {
  const allProjects = await db.select({ id: projects.id }).from(projects).all();
  let touched = 0;
  let rolesInserted = 0;

  for (const proj of allProjects) {
    const projectId = proj.id;
    const roles = await db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.projectId, projectId))
      .all();

    let projectTouched = false;

    db.transaction((tx) => {
      const now = new Date().toISOString();

      // 1. Owner: identify by kind='owner' OR (isSystem=1 AND kind IS NULL).
      //    Guest is isSystem=1 but kind='guest', so it is excluded here.
      const ownerRow = roles.find(
        r => r.kind === "owner" || (r.isSystem === 1 && r.kind == null),
      );
      if (ownerRow) {
        const needsKindFix = ownerRow.kind !== "owner";
        const needsCapsFix = ownerRow.capabilities !== FULL_CAPS_JSON;
        if (needsKindFix || needsCapsFix) {
          tx.update(projectRoles)
            .set({ kind: "owner", capabilities: FULL_CAPS_JSON, updatedAt: now })
            .where(eq(projectRoles.id, ownerRow.id))
            .run();
          projectTouched = true;
        }
      }

      // 2. Guest: insert kind='guest' system role only if none exists.
      const hasGuest = roles.some(r => r.kind === "guest");
      if (!hasGuest) {
        tx.insert(projectRoles).values({
          id: nanoid(),
          projectId,
          name: "Guest",
          capabilities: "[]",
          isSystem: 1,
          kind: "guest",
          createdAt: now,
          updatedAt: now,
        }).run();
        rolesInserted++;
        projectTouched = true;
      }

      // 3. Member → Reader: rename "Member" (isSystem=0, kind=null) to "Reader"
      //    and set caps. Preserves the row id, keeping member assignments intact.
      const memberRole = roles.find(
        r => r.name === "Member" && r.isSystem === 0 && r.kind == null,
      );
      if (memberRole) {
        tx.update(projectRoles)
          .set({
            name: "Reader",
            capabilities: JSON.stringify([...READER_CAPS]),
            updatedAt: now,
          })
          .where(eq(projectRoles.id, memberRole.id))
          .run();
        projectTouched = true;
      }

      // 4. Presets: insert missing Reader / Commenter / Writer by name.
      //    After step 3, a "Reader" row may already exist (either renamed or
      //    previously seeded). Check current names to avoid duplicates.
      const existingNames = new Set(roles.map(r => r.name));
      // If step 3 just renamed Member→Reader, treat "Reader" as present.
      if (memberRole)
        existingNames.add("Reader");

      const presets: Array<{ name: string; caps: readonly ProjectCapability[] }> = [
        { name: "Reader", caps: READER_CAPS },
        { name: "Commenter", caps: COMMENTER_CAPS },
        { name: "Writer", caps: WRITER_CAPS },
      ];

      for (const preset of presets) {
        if (!existingNames.has(preset.name)) {
          tx.insert(projectRoles).values({
            id: nanoid(),
            projectId,
            name: preset.name,
            capabilities: JSON.stringify([...preset.caps]),
            isSystem: 0,
            kind: null,
            createdAt: now,
            updatedAt: now,
          }).run();
          rolesInserted++;
          projectTouched = true;
        }
      }
    });

    if (projectTouched)
      touched++;
  }

  return {
    projectsScanned: allProjects.length,
    projectsTouched: touched,
    rolesInserted,
  };
}
