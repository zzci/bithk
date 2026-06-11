import type { AppDatabase } from "@/db";
import type { ModuleKey } from "@/shared/modules";
import { eq } from "drizzle-orm";
import { AppError, ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { MODULE_KEYS } from "@/shared/modules";
import { globalRoles } from "./schema";

export type GlobalRoleRow = typeof globalRoles.$inferSelect;

export interface GlobalRoleView {
  readonly id: string;
  readonly name: string;
  readonly modules: readonly ModuleKey[];
  readonly isSystem: boolean;
  readonly kind: "default" | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const MODULE_KEY_SET = new Set<string>(MODULE_KEYS);

/** Parse the stored JSON module list, dropping anything unknown. */
export function parseModules(raw: string): ModuleKey[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((m): m is ModuleKey => typeof m === "string" && MODULE_KEY_SET.has(m));
  }
  catch {
    return [];
  }
}

export function composeGlobalRole(row: GlobalRoleRow): GlobalRoleView {
  return {
    id: row.id,
    name: row.name,
    modules: parseModules(row.modules),
    isSystem: row.isSystem === 1,
    kind: row.kind ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Reject (422) any module key not in the static registry. */
function assertValidModules(modules: readonly string[]): asserts modules is ModuleKey[] {
  const invalid = modules.filter(m => !MODULE_KEY_SET.has(m));
  if (invalid.length > 0) {
    throw new ValidationError("Unknown module keys", { modules: invalid });
  }
}

/** Role names are globally unique; collisions surface as a clean 409. */
async function assertNameAvailable(db: AppDatabase, name: string, excludeId?: string): Promise<void> {
  const taken = await db.select({ id: globalRoles.id }).from(globalRoles).where(eq(globalRoles.name, name)).get();
  if (taken && taken.id !== excludeId)
    throw new AppError("Role name already taken", 409, "CONFLICT");
}

// ─── Default role + boot backfill ──────────────────────────────────────────

export const DEFAULT_ROLE_NAME = "Member";

// `hr` is deliberately excluded: hr is admin-only today, and the rollout
// criterion is "existing users keep exactly today's visibility". Admins can
// grant it per role once the module opens up.
export const DEFAULT_ROLE_MODULES: readonly ModuleKey[] = ["documents", "drive", "projects", "ships", "contacts"];

export interface GlobalRolesBackfillResult {
  readonly created: boolean;
}

/**
 * Self-healing idempotent boot backfill (same pattern as
 * `backfillProjectRoles`): ensure the kind='default' system role exists. When
 * it already exists only the `isSystem` flag is repaired — name and modules
 * are admin-editable and must never be clobbered by a reboot.
 */
export async function backfillGlobalRoles(db: AppDatabase): Promise<GlobalRolesBackfillResult> {
  const existing = await db.select().from(globalRoles).where(eq(globalRoles.kind, "default")).get();
  const now = new Date().toISOString();

  if (existing) {
    if (existing.isSystem !== 1) {
      await db.update(globalRoles)
        .set({ isSystem: 1, updatedAt: now })
        .where(eq(globalRoles.id, existing.id))
        .run();
    }
    return { created: false };
  }

  await db.insert(globalRoles).values({
    id: nanoid(),
    name: DEFAULT_ROLE_NAME,
    modules: JSON.stringify([...DEFAULT_ROLE_MODULES]),
    isSystem: 1,
    kind: "default",
    createdAt: now,
    updatedAt: now,
  }).run();
  return { created: true };
}

/** The kind='default' system role. Guaranteed by the boot backfill. */
export async function resolveDefaultRole(db: AppDatabase): Promise<GlobalRoleRow | undefined> {
  return await db.select().from(globalRoles).where(eq(globalRoles.kind, "default")).get();
}

/**
 * Resolve the module set a user may see: admins get every registered module;
 * everyone else gets their assigned role's modules, falling back to the
 * default role when `globalRoleId` is NULL or dangling. A missing default
 * role (corrupted DB — backfill never ran) fails closed to no modules.
 */
export async function resolveUserModules(
  db: AppDatabase,
  user: { role: string; globalRoleId: string | null },
): Promise<ModuleKey[]> {
  if (user.role === "admin")
    return [...MODULE_KEYS];

  let role: GlobalRoleRow | undefined;
  if (user.globalRoleId)
    role = await db.select().from(globalRoles).where(eq(globalRoles.id, user.globalRoleId)).get();
  if (!role)
    role = await resolveDefaultRole(db);
  if (!role)
    return [];
  return parseModules(role.modules);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listGlobalRoles(db: AppDatabase): Promise<readonly GlobalRoleRow[]> {
  return await db.select().from(globalRoles).orderBy(globalRoles.name).all();
}

export async function getGlobalRole(db: AppDatabase, id: string): Promise<GlobalRoleRow | undefined> {
  return await db.select().from(globalRoles).where(eq(globalRoles.id, id)).get();
}

export interface CreateGlobalRoleInput {
  readonly name: string;
  readonly modules?: readonly string[] | undefined;
}

export async function createGlobalRole(db: AppDatabase, input: CreateGlobalRoleInput): Promise<GlobalRoleRow> {
  const modules = input.modules ?? [];
  assertValidModules(modules);
  await assertNameAvailable(db, input.name);

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(globalRoles).values({
    id,
    name: input.name,
    modules: JSON.stringify(modules),
    isSystem: 0,
    kind: null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await getGlobalRole(db, id))!;
}

export interface UpdateGlobalRoleInput {
  readonly name?: string | undefined;
  readonly modules?: readonly string[] | undefined;
}

/**
 * Update name and/or modules. The system default role is updatable too — its
 * module set is explicitly admin-editable; only deletion is forbidden.
 */
export async function updateGlobalRole(
  db: AppDatabase,
  id: string,
  input: UpdateGlobalRoleInput,
): Promise<GlobalRoleRow | undefined> {
  const existing = await getGlobalRole(db, id);
  if (!existing)
    return undefined;

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined) {
    await assertNameAvailable(db, input.name, id);
    patch.name = input.name;
  }
  if (input.modules !== undefined) {
    assertValidModules(input.modules);
    patch.modules = JSON.stringify(input.modules);
  }
  await db.update(globalRoles).set(patch).where(eq(globalRoles.id, id)).run();
  return await getGlobalRole(db, id);
}

export type DeleteGlobalRoleResult = "deleted" | "not_found" | "system";

/**
 * Delete a custom role. Refuses system roles (the default role must always
 * exist). Holders fall back to the default role via the `users.global_role_id`
 * ON DELETE SET NULL action — no manual reassignment needed.
 */
export async function deleteGlobalRole(db: AppDatabase, id: string): Promise<DeleteGlobalRoleResult> {
  const existing = await getGlobalRole(db, id);
  if (!existing)
    return "not_found";
  if (existing.isSystem === 1)
    return "system";
  await db.delete(globalRoles).where(eq(globalRoles.id, id)).run();
  return "deleted";
}
