// Section mount/unmount service (PLAN-108 §2/§3). Owns every read and write of
// `project_sections`; nothing else touches that table directly.

import type { SQL } from "drizzle-orm";
import type { ProjectPreset, SectionProvisionContext } from "./section.registry";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { AppError, NotFoundError, ValidationError } from "@/shared/lib/errors";
import { projects, projectSections } from "./schema";
import { getProjectSection, PRESET_SECTION_KEYS, PROJECT_PRESETS } from "./section.registry";

/** Gap between adjacent `sort_order` values, so a later mount can be slotted between two. */
const SORT_STEP = 10;

/**
 * Run one section's `provision` hook, if it has one. Both mount paths go
 * through here so a late mount seeds exactly what a preset create seeds.
 *
 * Synchronous by necessity — bun:sqlite transactions are, so a hook that
 * deferred its writes past an await would land after COMMIT. A hook returning a
 * promise is therefore rejected loudly rather than silently losing its writes.
 */
function runProvision(tx: AppTransaction, projectId: string, key: string, ctx: SectionProvisionContext): void {
  const provision = getProjectSection(key)?.provision;
  if (!provision)
    return;
  // Typed `unknown` so the runtime guard survives the declared `void`
  // return: the compile-time rejection of an async hook lives in
  // `ProjectSectionDefinition`, this stays as the defence in depth.
  const pending: unknown = provision(tx, projectId, ctx);
  if (pending instanceof Promise)
    throw new Error(`Project section '${key}' provisioned asynchronously; provision hooks must write synchronously inside the transaction`);
}

/**
 * Mount every section of `preset` on a freshly created project, then run each
 * registered section's `provision` hook in the same preset order. Runs inside
 * the caller's transaction so creation stays one atomic unit.
 *
 * A preset key with no registered definition still gets its mount row: sections
 * register from their owning module's barrel, and provisioning must not depend
 * on which barrels an entrypoint happened to import.
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

  for (const key of keys)
    runProvision(tx, projectId, key, ctx);
}

/**
 * Mount a section on an existing project, appended after the current last one,
 * and run its `provision` hook in the SAME transaction as the mount row
 * (PLAN-108 §5): a late mount must leave the section as fully seeded as the
 * preset would have, so "section mounted" and "profile row exists" stay
 * equivalent. A hook that throws rolls the mount row back with it, leaving no
 * half-mounted section.
 *
 * `sectionData` is this ONE section's raw create payload — the same slice
 * `POST /projects` passes as `sectionData[key]`. It is handed to the hook
 * untouched; the owning section validates its own shape.
 *
 * Idempotent: re-mounting an already-mounted section is a no-op (and provisions
 * nothing a second time). Rejects a key that is neither in a preset nor
 * registered.
 */
export async function mountSection(
  db: AppDatabase,
  projectId: string,
  key: string,
  sectionData?: unknown,
): Promise<void> {
  if (!PRESET_SECTION_KEYS.includes(key) && !getProjectSection(key))
    throw new ValidationError(`Unknown project section '${key}'`, { key });

  if (await hasSection(db, projectId, key))
    return;

  // The hook's context wants the project's creator; a mount has no create input
  // to read it from. Reading the row also fails fast on a project that is gone.
  const project = await db.select({ creatorId: projects.creatorId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project)
    throw new NotFoundError("Project", projectId);

  const last = await db.select({ value: max(projectSections.sortOrder) })
    .from(projectSections)
    .where(eq(projectSections.projectId, projectId))
    .get();
  const sortOrder = last?.value === null || last?.value === undefined ? 0 : last.value + SORT_STEP;
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(projectSections)
      .values({ projectId, key, sortOrder, createdAt: now })
      .onConflictDoNothing()
      .run();
    runProvision(tx, projectId, key, {
      // No preset: a late mount answers to none.
      now,
      creatorId: project.creatorId,
      sectionData: sectionData === undefined ? undefined : { [key]: sectionData },
    });
  });
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

/**
 * A `projects` WHERE condition keeping only the rows with `key` mounted, for
 * the list endpoint's section filter (PLAN-108 §8). It lives here so
 * `project_sections` keeps its single owner, and it is a condition rather than
 * an id array so the list stays ONE query and filters BEFORE pagination.
 *
 * Written key-first (`WHERE key = ?`, projecting `project_id`) so the subquery
 * rides `project_sections_key_idx (key, project_id)` as a covering index —
 * the index PLAN-108 §2 added for exactly this read.
 */
export function sectionMountedFilter(db: AppDatabase, key: string): SQL {
  return inArray(
    projects.id,
    db.select({ projectId: projectSections.projectId })
      .from(projectSections)
      .where(eq(projectSections.key, key)),
  );
}

export async function hasSection(db: AppDatabase, projectId: string, key: string): Promise<boolean> {
  const row = await db.select({ key: projectSections.key })
    .from(projectSections)
    .where(and(eq(projectSections.projectId, projectId), eq(projectSections.key, key)))
    .get();
  return row !== undefined;
}
