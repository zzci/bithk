// Section mount/unmount service (PLAN-108 §2/§3). Owns every read and write of
// `project_sections`; nothing else touches that table directly.

import type { ProjectPreset, SectionProvisionContext } from "./section.registry";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { AppError, ValidationError } from "@/shared/lib/errors";
import { projectSections } from "./schema";
import { getProjectSection, PRESET_SECTION_KEYS, PROJECT_PRESETS } from "./section.registry";

/** Gap between adjacent `sort_order` values, so a later mount can be slotted between two. */
const SORT_STEP = 10;

/**
 * Mount every section of `preset` on a freshly created project, then run each
 * registered section's `provision` hook in the same preset order. Runs inside
 * the caller's transaction so creation stays one atomic unit.
 *
 * A preset key with no registered definition still gets its mount row: sections
 * register from their owning module's barrel, and provisioning must not depend
 * on which barrels an entrypoint happened to import.
 *
 * Synchronous by necessity — bun:sqlite transactions are, so a hook that
 * deferred its writes past an await would land after COMMIT. A hook returning a
 * promise is therefore rejected loudly rather than silently losing its writes.
 */
export function provisionSections(
  tx: AppTransaction,
  projectId: string,
  preset: ProjectPreset,
  ctx: SectionProvisionContext,
): void {
  const keys = PROJECT_PRESETS[preset];

  keys.forEach((key, i) => {
    tx.insert(projectSections).values({
      projectId,
      key,
      sortOrder: i * SORT_STEP,
      createdAt: ctx.now,
    }).run();
  });

  for (const key of keys) {
    const provision = getProjectSection(key)?.provision;
    if (!provision)
      continue;
    // Typed `unknown` so the runtime guard survives the declared `void`
    // return: the compile-time rejection of an async hook lives in
    // `ProjectSectionDefinition`, this stays as the defence in depth.
    const pending: unknown = provision(tx, projectId, ctx);
    if (pending instanceof Promise)
      throw new Error(`Project section '${key}' provisioned asynchronously; provision hooks must write synchronously inside the transaction`);
  }
}

/**
 * Mount a section on an existing project, appended after the current last one.
 * Idempotent: re-mounting an already-mounted section is a no-op, not an error.
 * Rejects a key that is neither in a preset nor registered.
 */
export async function mountSection(db: AppDatabase, projectId: string, key: string): Promise<void> {
  if (!PRESET_SECTION_KEYS.includes(key) && !getProjectSection(key))
    throw new ValidationError(`Unknown project section '${key}'`, { key });

  if (await hasSection(db, projectId, key))
    return;

  const last = await db.select({ value: max(projectSections.sortOrder) })
    .from(projectSections)
    .where(eq(projectSections.projectId, projectId))
    .get();
  const sortOrder = last?.value === null || last?.value === undefined ? 0 : last.value + SORT_STEP;

  await db.insert(projectSections)
    .values({ projectId, key, sortOrder, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
}

/**
 * Unmount a section. Refuses with 409 while the section still holds data (v1
 * rule: no data loss, no soft "disabled" state). Unmounting a section that is
 * not mounted is a no-op.
 */
export async function unmountSection(db: AppDatabase, projectId: string, key: string): Promise<void> {
  const hasData = getProjectSection(key)?.hasData;
  if (hasData && await hasData(db, projectId))
    throw new AppError(`Section '${key}' still has data and cannot be unmounted`, 409, "SECTION_NOT_EMPTY");

  await db.delete(projectSections)
    .where(and(eq(projectSections.projectId, projectId), eq(projectSections.key, key)))
    .run();
}

/** A project's mounted section keys, in tab order. */
export async function listSections(db: AppDatabase, projectId: string): Promise<string[]> {
  const rows = await db.select({ key: projectSections.key })
    .from(projectSections)
    .where(eq(projectSections.projectId, projectId))
    .orderBy(asc(projectSections.sortOrder))
    .all();
  return rows.map(r => r.key);
}

/**
 * Batch loader for the list endpoint: ONE query for every project's sections,
 * keyed by internal project id, each list in tab order. Never issue
 * `listSections` per row.
 */
export async function loadSectionsForProjects(
  db: AppDatabase,
  projectIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (projectIds.length === 0)
    return result;

  const rows = await db.select({ projectId: projectSections.projectId, key: projectSections.key })
    .from(projectSections)
    .where(inArray(projectSections.projectId, [...projectIds]))
    .orderBy(asc(projectSections.sortOrder))
    .all();

  for (const r of rows) {
    const list = result.get(r.projectId);
    if (list)
      list.push(r.key);
    else
      result.set(r.projectId, [r.key]);
  }
  return result;
}

export async function hasSection(db: AppDatabase, projectId: string, key: string): Promise<boolean> {
  const row = await db.select({ key: projectSections.key })
    .from(projectSections)
    .where(and(eq(projectSections.projectId, projectId), eq(projectSections.key, key)))
    .get();
  return row !== undefined;
}
