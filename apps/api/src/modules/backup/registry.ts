import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BackupManifestV2 } from "./archive.service";
import { getTableName } from "drizzle-orm";

/** One NDJSON archive row / one live row, keyed by drizzle property names. */
export type BackupRow = Record<string, unknown>;

/**
 * Fill value for a NEW NOT-NULL live column absent from old archives
 * (mapping rule 4): a constant, or a function of the incoming row.
 */
export type BackupImportFallback = ((row: BackupRow) => unknown) | unknown;

/** One output of a transform: the live table the row should land in. */
export interface TransformedRow {
  readonly table: string;
  readonly row: BackupRow;
}

/**
 * Read-only services available to `BackupImportTransform.apply` (PLAN-075
 * R2). Lookups observe the pre-import DB state — rows inserted by the
 * running import are not visible. The id-mapping store is shared across all
 * transforms of one import run, so a transform on a parent table can record
 * an id remap that a later child-table transform consumes (rule 14).
 */
export interface TransformContext {
  /**
   * First live row matching all equality conditions, or `undefined`.
   * Tables and conditions use drizzle property names (NDJSON row keys).
   */
  readonly lookup: (table: string, conds: Readonly<Record<string, unknown>>) => BackupRow | undefined;
  /** Record an old-archive-id → live-id mapping under a table namespace. */
  readonly setMappedId: (table: string, oldId: unknown, newId: unknown) => void;
  /** Read a mapping recorded earlier in this run; `undefined` if absent. */
  readonly getMappedId: (table: string, oldId: unknown) => unknown;
  /**
   * Count the CURRENT input row as `skippedDuplicate` on its source table.
   * Pass `"remapped"` when incoming references were redirected to an
   * existing live row (rule 14) — the report flags the count.
   */
  readonly skipAsDuplicate: (flag?: "remapped") => void;
}

/**
 * Reshape old-archive rows during import (rename / split / move / drop) —
 * mapping rules 8 and 14. Runs in the Map stage, before column mapping, so
 * the output is itself checked against the live schema. A transform claiming
 * `fromTable` overrides the "skip vanished table" rule 7: the old table's
 * rows flow into their new home and are counted `transformed` there.
 */
export interface BackupImportTransform {
  /** Table name as it appears IN THE ARCHIVE (the old name). */
  readonly fromTable: string;
  /** Gate on archive age, e.g. journal position or column presence. */
  readonly appliesTo: (manifest: BackupManifestV2) => boolean;
  /** Map one old row to zero or more (table, row) outputs. */
  readonly apply: (row: BackupRow, ctx: TransformContext) => readonly TransformedRow[];
}

/**
 * Description of a single logical "data module" — the unit that the backup
 * UI exposes to operators (one checkbox each). Modules register their own
 * contribution via `registerBackupContribution()` from their `index.ts`,
 * which keeps `apps/api/src/modules/backup/` from owning a central list of
 * everyone else's tables.
 *
 * - `name`: stable identifier that ends up in `backupData.modules` and in
 *   the `/api/backup/modules` response. Renaming breaks compatibility with
 *   existing backup files.
 * - `tables`: every table the module wants exported / restored. Order
 *   determines the per-module insert order; combined with the topological
 *   `deps` walk, the global insert order respects foreign keys.
 * - `deps`: names of other modules whose tables must come before this one
 *   on insert (and after on delete). String-based so registration is order-
 *   independent and free of import cycles.
 */
export interface BackupContribution {
  readonly name: string;
  readonly tables: readonly SQLiteTable[];
  readonly deps: readonly string[];
  /** v2: fill values for NEW NOT-NULL columns absent from old archives (rule 4), keyed table → column. */
  readonly importFallbacks?: Readonly<Record<string, Readonly<Record<string, BackupImportFallback>>>>;
  /** v2: reshape old-archive rows (rename / split / move / drop) — rules 8/14. */
  readonly importTransforms?: readonly BackupImportTransform[];
}

const contributions = new Map<string, BackupContribution>();

export function registerBackupContribution(c: BackupContribution): void {
  // Idempotent: re-importing a module index during dev HMR / test reruns
  // must not double-register tables. Last write wins so the most recent
  // module-load result is the source of truth.
  contributions.set(c.name, c);
}

/** Test-only helper. Production never clears the registry. */
export function __resetBackupRegistryForTests(): void {
  contributions.clear();
}

export function getDataModules(): Record<string, BackupContribution> {
  return Object.fromEntries(contributions);
}

/** Sorted alphabetically so the `/api/backup/modules` payload is stable. */
export function getModuleNames(): readonly string[] {
  return [...contributions.keys()].sort();
}

/**
 * Topologically expand `selected` to include every transitive dependency.
 * Order in the result is dependency-first, so the same array can be used
 * for inserts; reverse for deletes.
 */
export function resolveModulesWithDeps(selected: readonly string[]): string[] {
  const resolved = new Set<string>();
  // Guards against circular module dependencies (e.g. projects ↔ ships, whose
  // nullable circular FK makes each list the other as a dep). Restore relies on
  // `PRAGMA defer_foreign_keys` so any order within a cycle is safe; we only
  // need to break the recursion and include every node once.
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (resolved.has(name) || visiting.has(name))
      return;
    const mod = contributions.get(name);
    if (!mod)
      return;
    visiting.add(name);
    for (const dep of mod.deps)
      visit(dep);
    visiting.delete(name);
    resolved.add(name);
  }

  for (const name of selected)
    visit(name);

  return [...resolved];
}

/**
 * All registered `importFallbacks`, merged across contributions and keyed by
 * table name. Modules only declare fallbacks for their own tables, so the
 * merge is a disjoint union in practice; on overlap the most recently
 * registered contribution wins (same last-write-wins rule as registration).
 */
export function getImportFallbacksByTable(): ReadonlyMap<string, Readonly<Record<string, BackupImportFallback>>> {
  const byTable = new Map<string, Record<string, BackupImportFallback>>();
  for (const mod of contributions.values()) {
    for (const [table, columns] of Object.entries(mod.importFallbacks ?? {}))
      byTable.set(table, { ...byTable.get(table), ...columns });
  }
  return byTable;
}

/**
 * All registered `importTransforms` keyed by archive (`fromTable`) name, in
 * registration order. The `appliesTo` gate is NOT evaluated here — the
 * import engine filters against the staged archive's manifest.
 */
export function getImportTransformsByTable(): ReadonlyMap<string, readonly BackupImportTransform[]> {
  const byTable = new Map<string, BackupImportTransform[]>();
  for (const mod of contributions.values()) {
    for (const transform of mod.importTransforms ?? []) {
      const list = byTable.get(transform.fromTable) ?? [];
      list.push(transform);
      byTable.set(transform.fromTable, list);
    }
  }
  return byTable;
}

/** Flatten the resolved module list into a deduplicated, ordered table list. */
export function getTablesForModules(modules: readonly string[]): SQLiteTable[] {
  const tables: SQLiteTable[] = [];
  const seen = new Set<string>();

  for (const mod of modules) {
    const def = contributions.get(mod);
    if (!def)
      continue;
    for (const table of def.tables) {
      const tableName = getTableName(table);
      if (!seen.has(tableName)) {
        seen.add(tableName);
        tables.push(table);
      }
    }
  }

  return tables;
}
