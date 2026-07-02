/**
 * Backup v2 CROSS-SCHEMA MAPPING ENGINE + rollback DRY-RUN (PLAN-075 R2,
 * import stages 2–4, Phase 2).
 *
 * The engine builds a live-schema view from the registry's drizzle tables
 * (`getTableColumns` / `getTableConfig` — no hand-maintained schema copy),
 * compares it against `manifest.tables[]`, and applies the schema-mapping
 * rules 1–15 from PLAN-075. Rule 4 consults the modules' registered
 * `importFallbacks`; rules 8/14 run the registered `importTransforms` in a
 * pre-pass before column mapping (Phase 4), so a transform's output is
 * itself checked against the live schema. Transform lookups observe the
 * pre-import DB state, which is identical in dry-run and apply — the
 * dry-run==apply report parity is preserved with hooks active.
 *
 * The engine has two entry points sharing one row loop (Phase 3):
 *
 * - {@link runImportDryRun} — the real mapping and real inserts execute in
 *   dependency order inside a transaction that ALWAYS rolls back, so
 *   duplicate counts, FK orphans, and constraint failures are observed,
 *   not predicted.
 * - {@link runImportMerge} — the identical loop in a COMMITTED synchronous
 *   transaction (bun:sqlite transactions must stay sync). Because both run
 *   the same code against the same DB state, a dry-run report always equals
 *   the report of the apply that follows it.
 */
import type { AnyColumn } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { BackupManifestV2, ManifestTable } from "./archive.service";
import type { BackupImportFallback, BackupImportTransform, BackupRow, TransformContext } from "./registry";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { getDataModules, getImportFallbacksByTable, getImportTransformsByTable, getModuleNames, resolveModulesWithDeps } from "./registry";

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
  /** Live-only NOT NULL columns filled from `importFallbacks` (rule 4). */
  readonly fallbackProps: readonly { readonly prop: string; readonly fallback: BackupImportFallback }[];
  /** Live-only NOT NULL columns without default or fallback (rule 5). */
  readonly missingRequired: readonly string[];
  /** Shared columns whose declared SQL type differs (rule 6). */
  readonly typeChanged: readonly { readonly prop: string; readonly from: string; readonly to: string }[];
  /** Duplicate-detection key: real PK, else first unique index. */
  readonly keyProps: readonly string[];
  /** Neither PK nor unique index — rows append as-is, table flagged. */
  readonly noKeyAppend: boolean;
}

export function buildTableMapping(
  live: LiveTableView,
  archive: ManifestTable,
  fallbacks?: Readonly<Record<string, BackupImportFallback>>,
): TableMapping {
  const archiveCols = new Map(archive.columns.map(c => [c.name, c]));

  const copyProps: string[] = [];
  const defaultedProps: string[] = [];
  const fallbackProps: { prop: string; fallback: BackupImportFallback }[] = [];
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
    else if (fallbacks && prop in fallbacks) {
      // Rule 4: the owning module's `importFallbacks` entry satisfies the
      // otherwise-unsatisfiable NEW NOT-NULL column.
      fallbackProps.push({ prop, fallback: fallbacks[prop] });
    }
    else {
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

  return { live, copyProps, droppedProps, defaultedProps, fallbackProps, missingRequired, typeChanged, keyProps, noKeyAppend: keyProps.length === 0 };
}

/** Resolve a rule-4 fallback for one row: constants pass through, functions are applied. */
function resolveFallback(fallback: BackupImportFallback, row: BackupRow): unknown {
  return typeof fallback === "function" ? (fallback as (row: BackupRow) => unknown)(row) : fallback;
}

/**
 * NDJSON blob codec, import side (mirrors the archive writer): a value bound
 * to a blob-typed live column arrives as a base64 string (the v2 exporter's
 * encoding) or as the legacy `{type:"Buffer",data:[...]}` JSON shape —
 * bun:sqlite binds neither, so decode both to a `Buffer`. Anything else
 * (already-binary values, null) passes through untouched.
 */
function decodeBlobColumnValue(value: unknown): unknown {
  if (typeof value === "string")
    return Buffer.from(value, "base64");
  if (
    typeof value === "object" && value !== null
    && (value as { type?: unknown }).type === "Buffer"
    && Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

// ─── Dry-run report ──────────────────────────────────────────────────────

export interface ImportFailedRow {
  readonly rowId: string;
  readonly reason: string;
}

export interface ImportTableReport {
  inserted: number;
  skippedDuplicate: number;
  /** Rows that arrived in this table via an `importTransform` from another archive table (rule 8). */
  transformed: number;
  droppedColumns: Record<string, number>;
  defaultedColumns: Record<string, number>;
  /** Rule 4: columns filled from `importFallbacks` — subset of `defaultedColumns` keys. */
  fallbackColumns?: string[];
  /** Rule 14: duplicate skips where a transform remapped incoming references — subset of `skippedDuplicate`. */
  remapped?: number;
  failed: { total: number; sample: ImportFailedRow[] };
  /** Table-level failure, e.g. `missing-required-column: <cols>` (rule 5). */
  error?: string;
  /** Set when the table has neither a PK nor a unique index (duplicates possible). */
  noKeyAppend?: boolean;
}

export interface ImportDryRunReport {
  /** `true` for the rollback dry-run, `false` for a committed merge apply. */
  readonly dryRun: boolean;
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
  return runMergeEngine(db, manifest, tables, false);
}

/**
 * The committed merge apply (Phase 3): the exact dry-run row loop, but the
 * transaction COMMITS. An unexpected engine error (e.g. a deferred-FK
 * failure at COMMIT) aborts the whole transaction — no partial table writes.
 */
export function runImportMerge(
  db: AppDatabase,
  manifest: BackupManifestV2,
  tables: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): ImportDryRunReport {
  return runMergeEngine(db, manifest, tables, true);
}

function runMergeEngine(
  db: AppDatabase,
  manifest: BackupManifestV2,
  tables: ReadonlyMap<string, readonly Record<string, unknown>[]>,
  commit: boolean,
): ImportDryRunReport {
  const liveView = buildLiveSchemaView();
  const knownModules = new Set(getModuleNames());
  const fallbacksByTable = getImportFallbacksByTable();

  // Transforms gated by `appliesTo(manifest)` — a hook for an already-
  // migrated archive simply does not exist for this run.
  const activeTransforms = new Map<string, BackupImportTransform[]>();
  for (const [fromTable, list] of getImportTransformsByTable()) {
    const active = list.filter(t => t.appliesTo(manifest));
    if (active.length > 0)
      activeTransforms.set(fromTable, active);
  }

  // Rule 10: modules unknown to the registry — tables skipped wholesale.
  const skippedModules = manifest.modules.map(m => m.name).filter(name => !knownModules.has(name));
  const skippedModuleSet = new Set(skippedModules);

  const candidates = new Map<string, ManifestTable>();
  const skippedTables: string[] = [];
  const claimed = new Set<string>(); // archive tables consumed by a transform (rules 8/14)
  for (const archiveTable of manifest.tables) {
    if (skippedModuleSet.has(archiveTable.module))
      continue;
    if (activeTransforms.has(archiveTable.name))
      claimed.add(archiveTable.name); // overrides rule 7 — rows re-home via the transform
    if (liveView.has(archiveTable.name))
      candidates.set(archiveTable.name, archiveTable);
    else if (!claimed.has(archiveTable.name))
      skippedTables.push(archiveTable.name); // rule 7
  }

  const report: ImportDryRunReport = {
    dryRun: !commit,
    tables: {},
    skippedTables,
    skippedModules,
    warnings: [],
    totals: { inserted: 0, skippedDuplicate: 0, failed: 0, transformed: 0 },
    blobs: { count: 0, existing: 0, missing: 0 },
  };

  const ensureTableReport = (name: string): ImportTableReport => {
    report.tables[name] ??= {
      inserted: 0,
      skippedDuplicate: 0,
      transformed: 0,
      droppedColumns: {},
      defaultedColumns: {},
      failed: { total: 0, sample: [] },
    };
    return report.tables[name]!;
  };

  // Duplicate-detection key from the live schema alone — transform-output
  // rows reuse it without an archive table definition.
  const keyPropsOf = (lt: LiveTableView): readonly string[] =>
    lt.primaryKey.length > 0 ? lt.primaryKey : (lt.uniqueIndexes[0]?.props ?? []);

  try {
    db.transaction((tx) => {
      // Same cycle-tolerance as v1: FK checks defer to COMMIT. In dry-run
      // mode COMMIT never comes (rollback below); in apply mode the FK
      // pre-check makes a COMMIT-time failure near-impossible, but if one
      // occurs the whole transaction aborts (no partial commit).
      tx.run(sql`PRAGMA defer_foreign_keys = 1`);

      const probe = (tableName: string, conds: { dbName: string; value: unknown }[]): boolean => {
        const where = conds.map(c => sql`${sql.identifier(c.dbName)} = ${c.value}`);
        const row = tx.get(sql`SELECT 1 FROM ${sql.identifier(tableName)} WHERE ${sql.join(where, sql` AND `)} LIMIT 1`) as unknown;
        return row !== null && row !== undefined;
      };

      // ── Transform pre-pass (rules 8/14): runs before column mapping ──
      // and before any insert, so `ctx.lookup` observes the pre-import DB
      // state — identical in dry-run and apply. Claimed live tables are
      // processed in live dependency order (parent transforms populate the
      // id-mapping store before child transforms read it), claimed vanished
      // tables after, in manifest order.
      const transformRows = new Map<string, { row: BackupRow; fromTable: string }[]>();
      const unknownTargets = new Map<string, number>();
      const idMap = new Map<string, unknown>();
      let currentFrom = "";

      const ctx: TransformContext = {
        lookup: (tableName, conds) => {
          const lt = liveView.get(tableName);
          const entries = Object.entries(conds);
          if (!lt || entries.length === 0 || entries.some(([prop, value]) => value === undefined || !lt.columns.has(prop)))
            return undefined;
          const cols = [...lt.columns.values()];
          const select = sql.join(cols.map(c => sql.identifier(c.dbName)), sql`, `);
          const where = entries.map(([prop, value]) => sql`${sql.identifier(lt.columns.get(prop)!.dbName)} = ${value}`);
          const hit = tx.get(sql`SELECT ${select} FROM ${sql.identifier(tableName)} WHERE ${sql.join(where, sql` AND `)} LIMIT 1`) as unknown;
          if (hit === null || hit === undefined)
            return undefined;
          // Raw-SQL `get` may return positional values (driver-dependent) —
          // reconstruct by the explicit SELECT column order either way.
          const byProp: BackupRow = {};
          cols.forEach((col, i) => {
            byProp[col.prop] = Array.isArray(hit) ? hit[i] : (hit as Record<string, unknown>)[col.dbName];
          });
          return byProp;
        },
        setMappedId: (table, oldId, newId) => idMap.set(`${table} ${String(oldId)}`, newId),
        getMappedId: (table, oldId) => idMap.get(`${table} ${String(oldId)}`),
        skipAsDuplicate: (flag) => {
          const tableReport = ensureTableReport(currentFrom);
          tableReport.skippedDuplicate++;
          report.totals.skippedDuplicate++;
          if (flag === "remapped")
            tableReport.remapped = (tableReport.remapped ?? 0) + 1; // rule 14
        },
      };

      const emit = (target: string, row: BackupRow, fromTable: string): void => {
        if (!liveView.has(target)) {
          unknownTargets.set(target, (unknownTargets.get(target) ?? 0) + 1);
          return;
        }
        const list = transformRows.get(target) ?? [];
        list.push({ row, fromTable });
        transformRows.set(target, list);
        if (target !== fromTable) {
          ensureTableReport(target).transformed++; // rule 8 — counted on the target table
          report.totals.transformed++;
        }
      };

      const claimedOrder = [
        ...[...liveView.keys()].filter(name => claimed.has(name)),
        ...[...claimed].filter(name => !liveView.has(name)),
      ];
      for (const fromTable of claimedOrder) {
        currentFrom = fromTable;
        // Chain transforms on the same archive table: same-table outputs
        // feed the next transform, foreign outputs are emitted directly.
        let rows: BackupRow[] = [...(tables.get(fromTable) ?? [])];
        for (const transform of activeTransforms.get(fromTable)!) {
          const next: BackupRow[] = [];
          for (const row of rows) {
            for (const out of transform.apply(row, ctx)) {
              if (out.table === fromTable)
                next.push(out.row);
              else
                emit(out.table, out.row, fromTable);
            }
          }
          rows = next;
        }
        for (const row of rows)
          emit(fromTable, row, fromTable);
      }
      for (const [target, count] of unknownTargets)
        report.warnings.push(`transform-output-unknown-table: ${target} (${count} row(s) dropped)`);

      // Process in live dependency order — rule 9 falls out for free: live
      // tables absent from the archive are simply never visited. Targets
      // that only receive transform output join the walk here.
      const processOrder = [...liveView.values()]
        .filter(lt => (candidates.has(lt.name) && !claimed.has(lt.name)) || transformRows.has(lt.name));

      // FK pre-check candidate sets (stage 3): the referenced id must exist
      // in the live table or in the to-be-inserted set. Rows already
      // inserted this run are visible to in-transaction probes; this set
      // covers forward references inside module cycles (projects ↔ ships).
      // Built from the EFFECTIVE row streams — transform output replaces a
      // claimed table's archive rows, so consumed ids (rule 14) drop out.
      const referencedProps = new Set<string>();
      for (const lt of liveView.values()) {
        for (const col of lt.columns.values()) {
          if (col.references)
            referencedProps.add(`${col.references.table}.${col.references.prop}`);
        }
      }
      const incoming = new Map<string, Set<unknown>>(); // `${table}.${prop}` → values
      for (const lt of processOrder) {
        const effectiveRows = [
          ...(claimed.has(lt.name) ? [] : tables.get(lt.name) ?? []),
          ...(transformRows.get(lt.name) ?? []).map(entry => entry.row),
        ];
        for (const prop of lt.columns.keys()) {
          const key = `${lt.name}.${prop}`;
          if (!referencedProps.has(key))
            continue;
          const set = incoming.get(key) ?? new Set<unknown>();
          for (const row of effectiveRows) {
            if (row[prop] !== undefined && row[prop] !== null)
              set.add(row[prop]);
          }
          incoming.set(key, set);
        }
      }

      // files.ref_count recount targets: files rows inserted by this import,
      // plus every files row referenced by an inserted file_references row
      // (incl. rule-14 remap targets). Merge inserts never maintain the
      // materialised count — an inserted files row carries the ARCHIVE's
      // value (stale when some of its references were skipped or failed) and
      // inserted references never bump the live row they point at.
      const recountFileIds = new Set<unknown>();

      // Shared per-row pipeline: rule 11 duplicate probe, rule 12 FK
      // pre-check, insert with rule 13 error classification. Identical for
      // archive-mapped and transform-output rows.
      const processMappedRow = (
        lt: LiveTableView,
        tableReport: ImportTableReport,
        mapped: Record<string, unknown>,
        rawRow: Record<string, unknown>,
        keyProps: readonly string[],
        index: number,
      ): "inserted" | "skipped" | "failed" => {
        const fail = (reason: string): "failed" => {
          tableReport.failed.total++;
          report.totals.failed++;
          if (tableReport.failed.sample.length < MAX_FAILED_SAMPLES)
            tableReport.failed.sample.push({ rowId: rowIdOf(rawRow, keyProps, index), reason });
          return "failed";
        };

        // Blob codec: decode base64 / legacy Buffer-JSON values headed for
        // blob-typed columns BEFORE the duplicate probe, so key comparisons
        // and the insert both see the binary value.
        for (const [prop, value] of Object.entries(mapped)) {
          if (lt.columns.get(prop)?.type === "blob")
            mapped[prop] = decodeBlobColumnValue(value);
        }

        // Rule 11: PK (or first-unique-index) probe — existing row wins.
        if (keyProps.length > 0) {
          const keyConds: { dbName: string; value: unknown }[] = [];
          let probeable = true;
          for (const prop of keyProps) {
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
            return "skipped";
          }
        }

        // Rule 12: application-level FK pre-check (live ∪ incoming).
        for (const [prop, value] of Object.entries(mapped)) {
          const ref = lt.columns.get(prop)?.references;
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
          return fail("missing-parent");
        }

        try {
          tx.insert(lt.table).values(mapped).run();
        }
        catch (err) {
          return fail(classifyInsertError(lt, err));
        }

        tableReport.inserted++;
        report.totals.inserted++;
        if (lt.name === "files" && mapped.id !== null && mapped.id !== undefined)
          recountFileIds.add(mapped.id);
        else if (lt.name === "file_references" && mapped.fileId !== null && mapped.fileId !== undefined)
          recountFileIds.add(mapped.fileId);
        return "inserted";
      };

      for (const lt of processOrder) {
        const tableReport = ensureTableReport(lt.name);
        const keyProps = keyPropsOf(lt);
        if (keyProps.length === 0)
          tableReport.noKeyAppend = true;
        let redacted = 0;
        const fallbackUsed = new Set<string>(tableReport.fallbackColumns ?? []);

        // ── Archive rows, mapped via the manifest table definition ──
        const archiveTable = claimed.has(lt.name) ? undefined : candidates.get(lt.name);
        if (archiveTable) {
          const rows = tables.get(lt.name) ?? [];
          const mapping = buildTableMapping(lt, archiveTable, fallbacksByTable.get(lt.name));

          for (const change of mapping.typeChanged)
            report.warnings.push(`type-changed: ${lt.name}.${change.prop} (${change.from} -> ${change.to})`); // rule 6

          // Rule 5: a NOT NULL live column without default or fallback
          // cannot be satisfied by any archive row — every archive row of
          // the table fails (transform-output rows below are unaffected).
          if (mapping.missingRequired.length > 0) {
            tableReport.error = `missing-required-column: ${mapping.missingRequired.join(", ")}`;
            tableReport.failed.total += rows.length;
            report.totals.failed += rows.length;
          }

          const mappableRows = mapping.missingRequired.length > 0 ? [] : rows;
          for (let i = 0; i < mappableRows.length; i++) {
            const row = mappableRows[i]!;
            const mapped: Record<string, unknown> = {};
            for (const prop of mapping.copyProps) {
              if (prop in row)
                mapped[prop] = row[prop];
            }
            for (const { prop, fallback } of mapping.fallbackProps)
              mapped[prop] = resolveFallback(fallback, row); // rule 4

            if (processMappedRow(lt, tableReport, mapped, row, mapping.keyProps, i) !== "inserted")
              continue;

            for (const prop of mapping.droppedProps) {
              if (prop in row)
                tableReport.droppedColumns[prop] = (tableReport.droppedColumns[prop] ?? 0) + 1; // rule 2
            }
            for (const prop of mapping.defaultedProps)
              tableReport.defaultedColumns[prop] = (tableReport.defaultedColumns[prop] ?? 0) + 1; // rule 3
            for (const { prop } of mapping.fallbackProps) {
              tableReport.defaultedColumns[prop] = (tableReport.defaultedColumns[prop] ?? 0) + 1; // rule 4
              fallbackUsed.add(prop);
            }
            for (const value of Object.values(row)) {
              if (value === REDACTED_SENTINEL)
                redacted++; // rule 15 — inserted verbatim, secret is unusable
            }
          }
        }

        // ── Transform-output rows, mapped per row against the live schema ──
        // (no archive definition exists for them; rule 5 degrades to a
        // per-row `missing-required-column` failure).
        const incomingTransformed = transformRows.get(lt.name) ?? [];
        const fallbacks = fallbacksByTable.get(lt.name);
        for (let i = 0; i < incomingTransformed.length; i++) {
          const row = incomingTransformed[i]!.row;
          const mapped: Record<string, unknown> = {};
          const dropped: string[] = [];
          const defaulted: string[] = [];
          const fellBack: string[] = [];
          const missing: string[] = [];
          for (const key of Object.keys(row)) {
            if (!lt.columns.has(key))
              dropped.push(key); // rule 2
          }
          for (const [prop, col] of lt.columns) {
            if (prop in row)
              mapped[prop] = row[prop]; // rule 1
            else if (!col.notNull || col.hasDefault)
              defaulted.push(prop); // rule 3
            else if (fallbacks && prop in fallbacks)
              fellBack.push(prop); // rule 4 — transforms first, then fallbacks
            else
              missing.push(prop); // rule 5, per row
          }
          if (missing.length > 0) {
            tableReport.failed.total++;
            report.totals.failed++;
            if (tableReport.failed.sample.length < MAX_FAILED_SAMPLES)
              tableReport.failed.sample.push({ rowId: rowIdOf(row, keyProps, i), reason: `missing-required-column: ${missing.join(", ")}` });
            continue;
          }
          for (const prop of fellBack)
            mapped[prop] = resolveFallback(fallbacks![prop], row);

          if (processMappedRow(lt, tableReport, mapped, row, keyProps, i) !== "inserted")
            continue;

          for (const prop of dropped)
            tableReport.droppedColumns[prop] = (tableReport.droppedColumns[prop] ?? 0) + 1;
          for (const prop of [...defaulted, ...fellBack])
            tableReport.defaultedColumns[prop] = (tableReport.defaultedColumns[prop] ?? 0) + 1;
          for (const prop of fellBack)
            fallbackUsed.add(prop);
          for (const value of Object.values(row)) {
            if (value === REDACTED_SENTINEL)
              redacted++; // rule 15
          }
        }

        if (fallbackUsed.size > 0)
          tableReport.fallbackColumns = [...fallbackUsed].sort();
        if (redacted > 0)
          report.warnings.push(`redacted-secrets: ${lt.name} contains ${redacted} redacted value(s)`);
      }

      // Recount before COMMIT, from live file_references — the same SQL the
      // blob stage's un-quarantine uses. Runs in dry-run too (rolled back),
      // so dry-run==apply report parity is unaffected by the fix.
      for (const id of recountFileIds) {
        tx.run(sql`
          UPDATE files
          SET ref_count = (SELECT COUNT(*) FROM file_references WHERE file_id = files.id)
          WHERE id = ${id}
        `);
      }

      if (!commit)
        throw new DryRunRollback();
    });
  }
  catch (err) {
    if (!(err instanceof DryRunRollback))
      throw err;
  }

  return report;
}
