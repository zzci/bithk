/**
 * Backup v2 CROSS-SCHEMA MAPPING ENGINE + rollback DRY-RUN (PLAN-075 R2,
 * import stages 2–4, Phase 2).
 *
 * The engine builds a live-schema view from the registry's drizzle tables
 * (`getTableColumns` / `getTableConfig` — no hand-maintained schema copy),
 * compares it against `manifest.tables[]`, and applies the schema-mapping
 * rules 1–13 and 15 from PLAN-075. Rule 4 (importFallbacks) and rules 8/14
 * (importTransforms) are Phase 4 — their execution seams are marked below.
 *
 * Phase 2 exposes the engine ONLY through {@link runImportDryRun}: the real
 * mapping and real inserts execute in dependency order inside a transaction
 * that ALWAYS rolls back, so duplicate counts, FK orphans, and constraint
 * failures are observed, not predicted. The committed write path is Phase 3.
 */
import type { AnyColumn } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BackupManifestV2, ManifestTable } from "./archive.service";
import type { AppDatabase } from "@/db";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { getDataModules, getModuleNames, resolveModulesWithDeps } from "./registry";

/** v1 token-export redaction sentinel (rule 15) — kept in sync with `export.routes.ts`. */
const REDACTED_SENTINEL = "[REDACTED]";

/** Failed-row samples are capped per table; totals stay exact. */
const MAX_FAILED_SAMPLES = 100;

// ─── Live-schema view ────────────────────────────────────────────────────

export interface LiveColumnView {
  /** Drizzle property name (camelCase) — identical to NDJSON row keys. */
  readonly prop: string;
  /** Physical column name, for raw SQL probes. */
  readonly dbName: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  /** FK target, from drizzle introspection. */
  readonly references?: { readonly table: string; readonly prop: string };
}

export interface LiveTableView {
  readonly table: SQLiteTable;
  readonly name: string;
  readonly module: string;
  /** Columns keyed by drizzle property name. */
  readonly columns: ReadonlyMap<string, LiveColumnView>;
  /** Primary-key property names (column-level or table-level composite). */
  readonly primaryKey: readonly string[];
  readonly uniqueIndexes: readonly {
    readonly name: string;
    readonly props: readonly string[];
    readonly dbColumns: readonly string[];
  }[];
}

function propertyNameOf(table: SQLiteTable, column: AnyColumn): string {
  for (const [prop, col] of Object.entries(getTableColumns(table) as Record<string, AnyColumn>)) {
    if (col === column || col.name === column.name)
      return prop;
  }
  return column.name;
}

function describeLiveTable(table: SQLiteTable, name: string, module: string): LiveTableView {
  const cols = getTableColumns(table) as Record<string, AnyColumn>;
  const config = getTableConfig(table);

  const dbNameToProp = new Map<string, string>();
  for (const [prop, col] of Object.entries(cols))
    dbNameToProp.set(col.name, prop);

  // FK lookup keyed by the local column's DB name — same introspection the
  // archive writer uses, so `references` matches the manifest format.
  const references = new Map<string, { table: string; prop: string }>();
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    for (let i = 0; i < ref.columns.length; i++) {
      const local = ref.columns[i]!;
      const foreign = ref.foreignColumns[i]!;
      references.set(local.name, {
        table: getTableName(ref.foreignTable),
        prop: propertyNameOf(ref.foreignTable, foreign),
      });
    }
  }

  const columns = new Map<string, LiveColumnView>();
  const primaryKey: string[] = [];
  for (const [prop, col] of Object.entries(cols)) {
    columns.set(prop, {
      prop,
      dbName: col.name,
      type: col.getSQLType(),
      notNull: col.notNull,
      hasDefault: col.hasDefault,
      ...(references.has(col.name) ? { references: references.get(col.name)! } : {}),
    });
    if (col.primary)
      primaryKey.push(prop);
  }
  if (primaryKey.length === 0) {
    for (const pk of config.primaryKeys)
      primaryKey.push(...pk.columns.map(c => propertyNameOf(table, c)));
  }

  const uniqueIndexes: { name: string; props: string[]; dbColumns: string[] }[] = [];
  for (const index of config.indexes) {
    if (!index.config.unique)
      continue;
    const dbColumns: string[] = [];
    for (const col of index.config.columns) {
      const dbName = (col as { name?: string }).name;
      if (!dbName) {
        dbColumns.length = 0;
        break; // expression index — unusable as a duplicate key
      }
      dbColumns.push(dbName);
    }
    if (dbColumns.length > 0)
      uniqueIndexes.push({ name: index.config.name ?? dbColumns.join("+"), props: dbColumns.map(d => dbNameToProp.get(d) ?? d), dbColumns });
  }

  return { table, name, module, columns, primaryKey, uniqueIndexes };
}

/**
 * Live tables keyed by table name, in global dependency order (the registry
 * walk that also orders inserts). The archive's own module order is ignored:
 * the live registry stays the single source of module/table ordering.
 */
export function buildLiveSchemaView(): Map<string, LiveTableView> {
  const registry = getDataModules();
  const view = new Map<string, LiveTableView>();
  for (const modName of resolveModulesWithDeps(getModuleNames())) {
    for (const table of registry[modName]?.tables ?? []) {
      const name = getTableName(table);
      if (!view.has(name))
        view.set(name, describeLiveTable(table, name, modName));
    }
  }
  return view;
}

// ─── Column mapping (rules 1–6) ──────────────────────────────────────────

export interface TableMapping {
  readonly live: LiveTableView;
  /** Columns present in both schemas — copied (rule 1). */
  readonly copyProps: readonly string[];
  /** Archive-only columns — values dropped, row kept (rule 2). */
  readonly droppedProps: readonly string[];
  /** Live-only columns that are nullable or defaulted — omitted (rule 3). */
  readonly defaultedProps: readonly string[];
  /** Live-only NOT NULL columns without default or fallback (rule 5). */
  readonly missingRequired: readonly string[];
  /** Shared columns whose declared SQL type differs (rule 6). */
  readonly typeChanged: readonly { readonly prop: string; readonly from: string; readonly to: string }[];
  /** Duplicate-detection key: real PK, else first unique index. */
  readonly keyProps: readonly string[];
  /** Neither PK nor unique index — rows append as-is, table flagged. */
  readonly noKeyAppend: boolean;
}

export function buildTableMapping(live: LiveTableView, archive: ManifestTable): TableMapping {
  const archiveCols = new Map(archive.columns.map(c => [c.name, c]));

  const copyProps: string[] = [];
  const defaultedProps: string[] = [];
  const missingRequired: string[] = [];
  const typeChanged: { prop: string; from: string; to: string }[] = [];
  for (const [prop, liveCol] of live.columns) {
    const archiveCol = archiveCols.get(prop);
    if (archiveCol) {
      copyProps.push(prop);
      if (archiveCol.type !== liveCol.type)
        typeChanged.push({ prop, from: archiveCol.type, to: liveCol.type });
    }
    else if (!liveCol.notNull || liveCol.hasDefault) {
      defaultedProps.push(prop);
    }
    else {
      // PHASE 4 SEAM (rule 4): the owning module's `importFallbacks` entry
      // is consulted here before declaring the column unsatisfiable.
      missingRequired.push(prop);
    }
  }

  const droppedProps: string[] = [];
  for (const name of archiveCols.keys()) {
    if (!live.columns.has(name))
      droppedProps.push(name);
  }

  const keyProps = live.primaryKey.length > 0
    ? live.primaryKey
    : (live.uniqueIndexes[0]?.props ?? []);

  return { live, copyProps, droppedProps, defaultedProps, missingRequired, typeChanged, keyProps, noKeyAppend: keyProps.length === 0 };
}

// ─── Dry-run report ──────────────────────────────────────────────────────

export interface ImportFailedRow {
  readonly rowId: string;
  readonly reason: string;
}

export interface ImportTableReport {
  inserted: number;
  skippedDuplicate: number;
  /** Always 0 in Phase 2 — transforms are Phase 4. */
  transformed: number;
  droppedColumns: Record<string, number>;
  defaultedColumns: Record<string, number>;
  failed: { total: number; sample: ImportFailedRow[] };
  /** Table-level failure, e.g. `missing-required-column: <cols>` (rule 5). */
  error?: string;
  /** Set when the table has neither a PK nor a unique index (duplicates possible). */
  noKeyAppend?: boolean;
}

export interface ImportDryRunReport {
  readonly dryRun: true;
  readonly tables: Record<string, ImportTableReport>;
  readonly skippedTables: string[];
  readonly skippedModules: string[];
  readonly warnings: string[];
  readonly totals: { inserted: number; skippedDuplicate: number; failed: number; transformed: number };
  /** Existence-check counts — blobs are NEVER written in this phase. */
  readonly blobs: { count: number; existing: number; missing: number };
}

/** Thrown to force ROLLBACK after the dry-run inserts complete. */
class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

function rowIdOf(row: Record<string, unknown>, keyProps: readonly string[], index: number): string {
  if (typeof row.id === "string")
    return row.id;
  const key = keyProps.map(p => row[p]).filter(v => v !== undefined && v !== null);
  return key.length > 0 ? key.map(String).join("/") : `index ${index}`;
}

/** Map a SQLite constraint error to the report reason vocabulary (rules 12/13). */
function classifyInsertError(live: LiveTableView, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const unique = message.match(/UNIQUE constraint failed: ([\w.,\s]+)/);
  if (unique) {
    const dbCols = unique[1]!.split(",").map(part => part.trim().split(".").pop()!).sort();
    const index = live.uniqueIndexes.find(u => u.dbColumns.length === dbCols.length
      && [...u.dbColumns].sort().every((c, i) => c === dbCols[i]));
    return `unique-conflict(${index?.name ?? dbCols.join("+")})`;
  }
  if (message.includes("FOREIGN KEY constraint failed"))
    return "missing-parent";
  return message;
}

/**
 * Execute the real mapping + real inserts in dependency order inside a
 * transaction that always rolls back (bun:sqlite transactions are
 * synchronous, mirroring v1's `importJsonBackup`). The returned report's
 * `blobs` counts are zero — the caller overlays the async existence check.
 */
export function runImportDryRun(
  db: AppDatabase,
  manifest: BackupManifestV2,
  tables: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): ImportDryRunReport {
  const liveView = buildLiveSchemaView();
  const knownModules = new Set(getModuleNames());

  // Rule 10: modules unknown to the registry — tables skipped wholesale.
  const skippedModules = manifest.modules.map(m => m.name).filter(name => !knownModules.has(name));
  const skippedModuleSet = new Set(skippedModules);

  const candidates = new Map<string, ManifestTable>();
  const skippedTables: string[] = [];
  for (const archiveTable of manifest.tables) {
    if (skippedModuleSet.has(archiveTable.module))
      continue;
    if (liveView.has(archiveTable.name))
      candidates.set(archiveTable.name, archiveTable);
    else
      skippedTables.push(archiveTable.name); // rule 7 (no transform claims it in Phase 2)
  }

  // Process in live dependency order — rule 9 falls out for free: live
  // tables absent from the archive are simply never visited.
  const processOrder = [...liveView.values()].filter(lt => candidates.has(lt.name));

  // FK pre-check candidate sets (stage 3): the referenced id must exist in
  // the live table or in the to-be-inserted set. Rows already inserted this
  // run are visible to in-transaction probes; this set covers forward
  // references inside module cycles (projects ↔ ships).
  const referencedProps = new Set<string>();
  for (const lt of liveView.values()) {
    for (const col of lt.columns.values()) {
      if (col.references)
        referencedProps.add(`${col.references.table}.${col.references.prop}`);
    }
  }
  const incoming = new Map<string, Set<unknown>>(); // `${table}.${prop}` → values
  for (const lt of processOrder) {
    const rows = tables.get(lt.name) ?? [];
    for (const prop of lt.columns.keys()) {
      const key = `${lt.name}.${prop}`;
      if (!referencedProps.has(key))
        continue;
      const set = incoming.get(key) ?? new Set<unknown>();
      for (const row of rows) {
        if (row[prop] !== undefined && row[prop] !== null)
          set.add(row[prop]);
      }
      incoming.set(key, set);
    }
  }

  const report: ImportDryRunReport = {
    dryRun: true,
    tables: {},
    skippedTables,
    skippedModules,
    warnings: [],
    totals: { inserted: 0, skippedDuplicate: 0, failed: 0, transformed: 0 },
    blobs: { count: 0, existing: 0, missing: 0 },
  };

  for (const lt of processOrder) {
    report.tables[lt.name] = {
      inserted: 0,
      skippedDuplicate: 0,
      transformed: 0,
      droppedColumns: {},
      defaultedColumns: {},
      failed: { total: 0, sample: [] },
    };
  }

  try {
    db.transaction((tx) => {
      // Same cycle-tolerance as v1: FK checks defer to COMMIT (which never
      // comes — the dry-run always rolls back before it).
      tx.run(sql`PRAGMA defer_foreign_keys = 1`);

      const probe = (tableName: string, conds: { dbName: string; value: unknown }[]): boolean => {
        const where = conds.map(c => sql`${sql.identifier(c.dbName)} = ${c.value}`);
        const row = tx.get(sql`SELECT 1 FROM ${sql.identifier(tableName)} WHERE ${sql.join(where, sql` AND `)} LIMIT 1`) as unknown;
        return row !== null && row !== undefined;
      };

      for (const lt of processOrder) {
        const archiveTable = candidates.get(lt.name)!;
        const rows = tables.get(lt.name) ?? [];
        const tableReport = report.tables[lt.name]!;
        const mapping = buildTableMapping(lt, archiveTable);

        for (const change of mapping.typeChanged)
          report.warnings.push(`type-changed: ${lt.name}.${change.prop} (${change.from} -> ${change.to})`); // rule 6

        // Rule 5: a NOT NULL live column without default cannot be satisfied
        // by any archive row — the whole table fails.
        if (mapping.missingRequired.length > 0) {
          tableReport.error = `missing-required-column: ${mapping.missingRequired.join(", ")}`;
          tableReport.failed.total = rows.length;
          report.totals.failed += rows.length;
          continue;
        }

        if (mapping.noKeyAppend)
          tableReport.noKeyAppend = true;

        let redacted = 0;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;

          // PHASE 4 SEAM (rules 8/14): registered `importTransforms` run
          // HERE, before column mapping, so transform output is itself
          // checked against the live schema. Phase 2 has no transform
          // registry — rows pass through unchanged, `transformed` stays 0.

          const mapped: Record<string, unknown> = {};
          for (const prop of mapping.copyProps) {
            if (prop in row)
              mapped[prop] = row[prop];
          }

          // Rule 11: PK (or first-unique-index) probe — existing row wins.
          if (!mapping.noKeyAppend) {
            const keyConds: { dbName: string; value: unknown }[] = [];
            let probeable = true;
            for (const prop of mapping.keyProps) {
              const value = mapped[prop];
              if (value === undefined) {
                probeable = false; // key column absent from the archive — append
                break;
              }
              keyConds.push({ dbName: lt.columns.get(prop)!.dbName, value });
            }
            if (probeable && probe(lt.name, keyConds)) {
              tableReport.skippedDuplicate++;
              report.totals.skippedDuplicate++;
              continue;
            }
          }

          // Rule 12: application-level FK pre-check (live ∪ incoming).
          let missingParent: string | undefined;
          for (const prop of mapping.copyProps) {
            const ref = lt.columns.get(prop)!.references;
            const value = mapped[prop];
            if (!ref || value === null || value === undefined)
              continue;
            const refLive = liveView.get(ref.table);
            if (!refLive)
              continue; // FK target outside the registry — leave it to SQL
            const refCol = refLive.columns.get(ref.prop);
            if (refCol && probe(ref.table, [{ dbName: refCol.dbName, value }]))
              continue; // live, or inserted earlier in this run
            if (incoming.get(`${ref.table}.${ref.prop}`)?.has(value))
              continue; // forward reference within the to-be-inserted set
            missingParent = prop;
            break;
          }
          if (missingParent) {
            tableReport.failed.total++;
            report.totals.failed++;
            if (tableReport.failed.sample.length < MAX_FAILED_SAMPLES)
              tableReport.failed.sample.push({ rowId: rowIdOf(row, mapping.keyProps, i), reason: "missing-parent" });
            continue;
          }

          try {
            tx.insert(lt.table).values(mapped).run();
          }
          catch (err) {
            tableReport.failed.total++;
            report.totals.failed++;
            if (tableReport.failed.sample.length < MAX_FAILED_SAMPLES)
              tableReport.failed.sample.push({ rowId: rowIdOf(row, mapping.keyProps, i), reason: classifyInsertError(lt, err) });
            continue;
          }

          tableReport.inserted++;
          report.totals.inserted++;
          for (const prop of mapping.droppedProps) {
            if (prop in row)
              tableReport.droppedColumns[prop] = (tableReport.droppedColumns[prop] ?? 0) + 1; // rule 2
          }
          for (const prop of mapping.defaultedProps)
            tableReport.defaultedColumns[prop] = (tableReport.defaultedColumns[prop] ?? 0) + 1; // rule 3
          for (const value of Object.values(row)) {
            if (value === REDACTED_SENTINEL)
              redacted++; // rule 15 — inserted verbatim, secret is unusable
          }
        }

        if (redacted > 0)
          report.warnings.push(`redacted-secrets: ${lt.name} contains ${redacted} redacted value(s)`);
      }

      throw new DryRunRollback();
    });
  }
  catch (err) {
    if (!(err instanceof DryRunRollback))
      throw err;
  }

  return report;
}
