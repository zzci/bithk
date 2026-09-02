/**
 * PLAN-108 one-shot database fold (DATA-003) -- the fold itself.
 *
 * Reads a pre-fold database whose single journal row is the pre-fold baseline,
 * builds a fresh target through the app's own `createDb()` (so `migrate()`
 * lays down the current schema -- no hand-written DDL), and copies every table
 * in backup-registry order inside ONE transaction while folding `ships` into
 * `ship_profiles` plus section mounts. The source is opened read-only and its
 * sha256 is measured before and after. The CLI in `plan108-fold.ts` parses
 * argv and prints the report; tests call `runFold()` directly.
 *
 * Every decision is computed from the source rows in memory BEFORE the target
 * is created (`planFold` + the transforms in `plan108-fold.transforms.ts`), so
 * a hard error (a live ship without a base project, equipment on an unknown
 * ship, an unexplained column difference) never leaves a half-written output
 * behind. Any failure after the target exists removes it.
 */
import type { CoverOutcome, FoldContext, FoldOptions, FoldPlan, FoldReport, PlanReport, SourceRow, TargetTable } from "./plan108-fold.types";
import type { AppDatabase } from "@/db";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createDb } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_MODULES_SETTING_KEY } from "@/modules/account/groups/module-gate";
import { getModuleNames, getTablesForModules, resolveModulesWithDeps } from "@/modules/backup/registry";
import { PROJECT_PRESETS } from "@/modules/project/section.registry";
import { checkMountIntegrity } from "../seed/seed.integrity";
import { COLUMN_MAP, requireText, text, transformTable } from "./plan108-fold.transforms";
import { FoldError } from "./plan108-fold.types";
// Side-effect import: loading the route barrels registers every module's
// backup contribution and project section without opening a DB or starting a
// server -- the same trick `scripts/lib/route-table.ts` relies on.
import "@/routes";

/** sha256 of the pre-fold baseline `0000_fluffy_zaladane.sql` -- the only accepted source epoch. */
export const PRE_FOLD_BASELINE_HASH = "51f69ce49143736e2028379d14255b57a84699523eb498538e1bb13b9cd785c0";

/** The data modules the current build registers; anything else means a partial module load. */
const EXPECTED_MODULES = [
  "contacts",
  "cron",
  "documents",
  "drive",
  "files",
  "hr",
  "issues",
  "items",
  "notification",
  "policies",
  "procurements",
  "projects",
  "settings",
  "share",
  "ships",
  "tags",
  "users",
];

/** Source tables never copied: the journal is rewritten by `migrate()`; `sqlite_*` is internal. */
const IGNORED_SOURCE_TABLES = new Set(["__drizzle_migrations"]);
/** Source tables that fold into a differently named target table. */
const CONSUMED_SOURCE_TABLES = new Set(["ships"]);

/** Run the whole fold. Resolves with the report; throws `FoldError` on any hard error. */
export async function runFold(opts: FoldOptions): Promise<FoldReport> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);
  if (from === to)
    throw new FoldError(`--from and --to resolve to the same file: ${from}`);
  if (!existsSync(from))
    throw new FoldError(`source database not found: ${from}`);
  if (existsSync(to) && !opts.force)
    throw new FoldError(`target already exists: ${to} (pass --force to replace it)`);

  const sourceSha256Before = await sha256File(from);
  const src = new Database(from, { readonly: true });
  let sourceJournalHash: string;
  let plan: FoldPlan;
  try {
    sourceJournalHash = assertPreFoldEpoch(src);
    assertModuleRegistry();
    plan = planFold(src, new Date().toISOString());
  }
  finally {
    src.close();
  }
  const sourceSha256After = await sha256File(from);
  if (sourceSha256After !== sourceSha256Before)
    throw new FoldError(`source file changed while it was being read: ${from}`);

  // Only past every validation is an existing output replaced.
  if (opts.force)
    removeDbFiles(to);
  try {
    const written = await writeTarget(to, plan);
    const checked = await selfCheckTarget(to);
    // Both connections are closed; a clean close checkpoints and removes the WAL.
    const walPath = `${to}-wal`;
    const selfCheck = { ...checked, walBytes: existsSync(walPath) ? statSync(walPath).size : null };
    return {
      from,
      to,
      sourceSha256Before,
      sourceSha256After,
      sourceJournalHash,
      ...written,
      ignoredSourceTables: plan.report.ignoredSourceTables,
      nonRegistryTables: plan.report.nonRegistryTables,
      tables: plan.tables.map(t => t.report),
      ships: plan.report.ships,
      parentsCleared: plan.report.parentsCleared,
      covers: plan.report.covers,
      tags: plan.report.tags,
      localBlobs: plan.report.localBlobs,
      selfCheck,
    };
  }
  catch (err) {
    removeDbFiles(to);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertPreFoldEpoch(src: Database): string {
  const hasJournal = src.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!hasJournal)
    throw new FoldError("source has no __drizzle_migrations table -- not a drizzle-managed database");
  const rows = src.query("SELECT hash FROM __drizzle_migrations ORDER BY id").all() as { hash: string }[];
  if (rows.length !== 1 || rows[0]!.hash !== PRE_FOLD_BASELINE_HASH) {
    const seen = rows.length === 0 ? "no rows" : rows.map(r => r.hash).join(", ");
    throw new FoldError(
      `source journal is not the pre-fold baseline: expected exactly one row with hash ${PRE_FOLD_BASELINE_HASH}, found ${rows.length} row(s): ${seen}`,
    );
  }
  return rows[0]!.hash;
}

function assertModuleRegistry(): void {
  const names = getModuleNames();
  const expected = EXPECTED_MODULES.join(",");
  if (names.join(",") !== expected)
    throw new FoldError(`backup registry mismatch: expected modules [${expected}], got [${names.join(",")}]`);
}

// ---------------------------------------------------------------------------
// Planning -- pure reads of the source, no target yet
// ---------------------------------------------------------------------------

/**
 * Target tables in write order: the backup registry's FK-safe order first,
 * then any table the schema declares outside the registry (auth/session
 * state, audit events, favorites) sorted by name. Nothing the current schema
 * knows is left out, so no source table is dropped for being unregistered.
 */
function targetTables(): { tables: TargetTable[]; nonRegistry: string[] } {
  const registry = getTablesForModules(resolveModulesWithDeps(getModuleNames()));
  const seen = new Set(registry.map(t => getTableName(t)));
  const extras = Object.values(schema as Record<string, unknown>)
    .filter((v): v is SQLiteTable => is(v, SQLiteTable))
    .filter(t => !seen.has(getTableName(t)))
    .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
  const toTarget = (t: SQLiteTable): TargetTable => ({
    name: getTableName(t),
    columns: Object.values(getTableColumns(t)).map(c => c.name),
  });
  return {
    tables: [...registry, ...extras].map(toTarget),
    nonRegistry: extras.map(t => getTableName(t)),
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function planFold(src: Database, now: string): FoldPlan {
  const { tables: targets, nonRegistry } = targetTables();
  const targetNames = new Set(targets.map(t => t.name));
  const sourceNames = (src.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map(r => r.name);

  const ignored: string[] = [];
  for (const name of sourceNames) {
    if (name.startsWith("sqlite_") || IGNORED_SOURCE_TABLES.has(name)) {
      ignored.push(name);
      continue;
    }
    if (CONSUMED_SOURCE_TABLES.has(name))
      continue;
    if (!targetNames.has(name))
      throw new FoldError(`source table '${name}' has no home in the current schema`);
  }
  for (const required of ["projects", "ships"]) {
    if (!sourceNames.includes(required))
      throw new FoldError(`source has no '${required}' table`);
  }

  const sourceSet = new Set(sourceNames);
  const readColumns = (name: string): string[] =>
    (src.query(`PRAGMA table_info(${quoteIdent(name)})`).all() as { name: string }[]).map(c => c.name);
  const readRows = (name: string): SourceRow[] =>
    src.query(`SELECT * FROM ${quoteIdent(name)}`).all() as SourceRow[];

  for (const t of targets) {
    if (!sourceSet.has(t.name))
      continue;
    const mapped = readColumns(t.name).map(c => COLUMN_MAP[t.name]?.[c] ?? c);
    const missing = t.columns.filter(c => !mapped.includes(c));
    const extra = mapped.filter(c => !t.columns.includes(c));
    if (missing.length > 0 || extra.length > 0) {
      throw new FoldError(
        `unexplained column difference on ${t.name}: missing in source [${missing.join(", ")}], extra in source [${extra.join(", ")}]`,
      );
    }
  }

  const source = new Map<string, SourceRow[]>();
  for (const t of targets) {
    if (sourceSet.has(t.name))
      source.set(t.name, readRows(t.name));
  }
  const ships = readRows("ships");

  const ctx = buildContext(source, ships, now);
  const tables = targets.map(t => transformTable(t, source.get(t.name), ships, ctx));
  ctx.report.ignoredSourceTables = ignored;
  ctx.report.nonRegistryTables = nonRegistry;
  return { tables, report: ctx.report };
}

function buildContext(source: ReadonlyMap<string, SourceRow[]>, ships: readonly SourceRow[], now: string): FoldContext {
  const projectsById = new Map((source.get("projects") ?? []).map(p => [requireText(p, "id"), p]));
  const report: PlanReport = {
    ignoredSourceTables: [],
    nonRegistryTables: [],
    ships: { folded: 0, skipped: [], nameMismatches: [], descriptionsFilled: [] },
    parentsCleared: [],
    covers: { gained: [], displaced: [], notApplied: [], retainedDuplicate: [], retainedShipSkipped: [] },
    tags: { renamed: [], merged: [] },
    modules: { groups: [], defaultModules: null, apiTokens: [] },
    localBlobs: [],
  };

  // Rule 2: which ships fold, which are skipped, which abort the run.
  const folded = new Map<string, SourceRow>();
  const byBase = new Map<string, SourceRow>();
  const hardErrors: string[] = [];
  for (const ship of ships) {
    const id = requireText(ship, "id");
    const base = text(ship, "base_project_id");
    const deletedAt = text(ship, "deleted_at");
    const label = `${id} (${text(ship, "code")} "${text(ship, "name")}")`;
    if (base === null) {
      if (deletedAt === null) {
        hardErrors.push(`live ship without base project: ${label}`);
        continue;
      }
      report.ships.skipped.push({ id, code: requireText(ship, "code"), name: requireText(ship, "name"), deletedAt });
      continue;
    }
    const project = projectsById.get(base);
    if (!project) {
      hardErrors.push(`ship ${label} points at missing base project ${base}`);
      continue;
    }
    if (byBase.has(base)) {
      hardErrors.push(`ship ${label} shares base project ${base} with ship ${requireText(byBase.get(base)!, "id")}`);
      continue;
    }
    folded.set(id, ship);
    byBase.set(base, ship);
    if (text(ship, "name") !== text(project, "name")) {
      report.ships.nameMismatches.push({
        shipId: id,
        shipName: requireText(ship, "name"),
        projectId: base,
        projectName: requireText(project, "name"),
      });
    }
  }
  if (hardErrors.length > 0)
    throw new FoldError(`ships that cannot be folded:\n  - ${hardErrors.join("\n  - ")}`);
  report.ships.folded = folded.size;

  // Rule 5: ship covers. Collisions are checked against every reference key
  // in the source plus the keys rewritten so far, so the unique index on
  // (owner_type, owner_id, file_id) can never fire at insert time.
  const coverRewrite = new Map<string, string>();
  const coverGain = new Map<string, string>();
  const refs = source.get("file_references") ?? [];
  const refIdByKey = new Map<string, string>();
  const keyOf = (ownerType: string, ownerId: string, fileId: string): string => `${ownerType} ${ownerId} ${fileId}`;
  for (const ref of refs)
    refIdByKey.set(keyOf(requireText(ref, "owner_type"), requireText(ref, "owner_id"), requireText(ref, "file_id")), requireText(ref, "id"));
  const candidates = new Map<string, CoverOutcome[]>();
  for (const ref of refs) {
    if (text(ref, "owner_type") !== "ship_cover")
      continue;
    const refId = requireText(ref, "id");
    const shipId = requireText(ref, "owner_id");
    const fileId = requireText(ref, "file_id");
    const ship = folded.get(shipId);
    if (!ship) {
      report.covers.retainedShipSkipped.push({ refId, fileId, shipId, projectId: "" });
      continue;
    }
    const projectId = requireText(ship, "base_project_id");
    const key = keyOf("project_cover", projectId, fileId);
    const existing = refIdByKey.get(key);
    if (existing !== undefined) {
      report.covers.retainedDuplicate.push({ refId, fileId, shipId, projectId, existingRefId: existing });
      continue;
    }
    refIdByKey.set(key, refId);
    coverRewrite.set(refId, projectId);
    const list = candidates.get(projectId) ?? [];
    list.push({ refId, fileId, shipId, projectId });
    candidates.set(projectId, list);
  }
  for (const [projectId, list] of candidates) {
    const project = projectsById.get(projectId)!;
    const ship = byBase.get(projectId)!;
    const current = text(project, "cover_reference_id");
    if (current !== null) {
      for (const c of list)
        report.covers.displaced.push({ ...c, currentCoverId: current });
      continue;
    }
    // Prefer the reference the ship itself pointed at; otherwise the first.
    const chosen = list.find(c => c.refId === text(ship, "cover_reference_id")) ?? list[0]!;
    coverGain.set(projectId, chosen.refId);
    report.covers.gained.push(chosen);
    for (const c of list) {
      if (c !== chosen)
        report.covers.notApplied.push(c);
    }
  }

  // Rule 4: ship tags become project tags, merging into a same-named one.
  const tagMerge = new Map<string, string>();
  const tags = source.get("tags") ?? [];
  const projectTagByName = new Map<string, string>();
  for (const tag of tags) {
    if (text(tag, "type") === "project")
      projectTagByName.set(requireText(tag, "name"), requireText(tag, "id"));
  }
  for (const tag of tags) {
    if (text(tag, "type") !== "ship")
      continue;
    const id = requireText(tag, "id");
    const name = requireText(tag, "name");
    const into = projectTagByName.get(name);
    if (into !== undefined) {
      tagMerge.set(id, into);
      report.tags.merged.push({ id, name, into });
    }
    else {
      report.tags.renamed.push({ id, name });
    }
  }

  for (const file of source.get("files") ?? []) {
    if (text(file, "storage_driver") === "local") {
      report.localBlobs.push({
        id: requireText(file, "id"),
        sha256: requireText(file, "sha256"),
        storageKey: requireText(file, "storage_key"),
        size: Number(file.size),
      });
    }
  }

  return { now, projectsById, folded, byBase, coverRewrite, coverGain, tagMerge, report };
}

// ---------------------------------------------------------------------------
// Writing and checking the target
// ---------------------------------------------------------------------------

interface WrittenReport {
  readonly targetJournal: readonly string[];
  readonly sections: FoldReport["sections"];
  readonly parents: FoldReport["parents"];
  readonly modules: FoldReport["modules"];
}

function readJournal(db: AppDatabase): string[] {
  return db.all<{ hash: string }>(sql`SELECT hash FROM __drizzle_migrations ORDER BY id`).map(r => r.hash);
}

/** First row as an object. Drizzle's bun-sqlite `get()` returns a bare values array for raw SQL; `all()` returns objects. */
function getOne<T>(db: AppDatabase, query: ReturnType<typeof sql>): T | undefined {
  return db.all<T>(query)[0];
}

async function writeTarget(to: string, plan: FoldPlan): Promise<WrittenReport> {
  const db = await createDb(to);
  try {
    const targetJournal = readJournal(db);

    db.transaction((tx) => {
      // Registry order is FK-safe except inside the old projects <-> ships
      // cycle; deferring the checks to COMMIT keeps the whole copy one atomic
      // unit, exactly like the backup import.
      tx.run(sql`PRAGMA defer_foreign_keys = 1`);
      for (const t of plan.tables) {
        const columns = sql.join(t.columns.map(c => sql.identifier(c)), sql.raw(", "));
        for (const row of t.rows) {
          const values = sql.join(t.columns.map(c => sql`${row[c] ?? null}`), sql.raw(", "));
          tx.run(sql`INSERT INTO ${sql.identifier(t.name)} (${columns}) VALUES (${values})`);
        }
      }
    });

    const fk = db.all(sql`PRAGMA foreign_key_check`);
    if (fk.length > 0)
      throw new FoldError(`foreign_key_check reported ${fk.length} row(s): ${JSON.stringify(fk.slice(0, 5))}`);
    const integrity = getOne<{ integrity_check: string }>(db, sql`PRAGMA integrity_check`);
    if (integrity?.integrity_check !== "ok")
      throw new FoldError(`integrity_check failed: ${JSON.stringify(integrity)}`);

    for (const t of plan.tables) {
      const row = getOne<{ n: number }>(db, sql`SELECT count(*) AS n FROM ${sql.identifier(t.name)}`);
      if (row?.n !== t.rows.length)
        throw new FoldError(`row count mismatch on ${t.name}: planned ${t.rows.length}, target holds ${row?.n}`);
    }

    // Spot checks measured on the committed target, not on the plan.
    const mounted = new Map<string, string[]>();
    for (const r of db.all<{ project_id: string; key: string }>(sql`SELECT project_id, key FROM project_sections ORDER BY project_id, sort_order`)) {
      const list = mounted.get(r.project_id) ?? [];
      list.push(r.key);
      mounted.set(r.project_id, list);
    }
    const shipList = PROJECT_PRESETS.ship.join(",");
    const generalList = PROJECT_PRESETS.general.join(",");
    let shipProjects = 0;
    let generalProjects = 0;
    const other: string[] = [];
    for (const [projectId, keys] of mounted) {
      const joined = keys.join(",");
      if (joined === shipList)
        shipProjects++;
      else if (joined === generalList)
        generalProjects++;
      else
        other.push(`${projectId}: ${joined}`);
    }
    const parents = db.all<{ id: string; parent_id: string }>(sql`SELECT id, parent_id FROM projects WHERE parent_id IS NOT NULL ORDER BY id`)
      .map(r => ({ projectId: r.id, parentId: r.parent_id }));
    const groupsAfter = db.all<{ id: string; name: string; modules: string }>(sql`SELECT id, name, modules FROM groups ORDER BY id`);
    const defaultModulesAfter = getOne<{ value: string }>(db, sql`SELECT value FROM settings WHERE key = ${DEFAULT_MODULES_SETTING_KEY}`)?.value ?? null;

    db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    return {
      targetJournal,
      sections: { rows: [...mounted.values()].reduce((n, l) => n + l.length, 0), shipProjects, generalProjects, other },
      parents,
      modules: { ...plan.report.modules, groupsAfter, defaultModulesAfter },
    };
  }
  finally {
    db.close();
  }
}

/** Reopen through `createDb` (migrate must be a no-op) and run the seed's mount check. */
async function selfCheckTarget(to: string): Promise<Omit<FoldReport["selfCheck"], "walBytes">> {
  const before = new Database(to, { readonly: true });
  let journalBefore: string[];
  try {
    journalBefore = (before.query("SELECT hash FROM __drizzle_migrations ORDER BY id").all() as { hash: string }[]).map(r => r.hash);
  }
  finally {
    before.close();
  }

  const db = await createDb(to);
  try {
    const journalAfter = readJournal(db);
    if (journalAfter.length !== journalBefore.length || journalAfter.at(-1) !== journalBefore.at(-1))
      throw new FoldError(`reopening the output applied migrations: journal ${journalBefore.length} -> ${journalAfter.length} rows`);
    const mount = await checkMountIntegrity(db);
    if (mount.violations.length > 0) {
      const detail = mount.violations.map(v => `${v.name} (${v.shortId}, ${v.preset}): missing ${v.missing.join(", ")}`);
      throw new FoldError(`mount integrity check failed for ${mount.violations.length} project(s):\n  - ${detail.join("\n  - ")}`);
    }
    const fk = db.all(sql`PRAGMA foreign_key_check`);
    const integrity = getOne<{ integrity_check: string }>(db, sql`PRAGMA integrity_check`)?.integrity_check ?? "missing";
    if (fk.length > 0 || integrity !== "ok")
      throw new FoldError(`post-fold check failed: foreign_key_check ${fk.length} row(s), integrity_check ${integrity}`);
    db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    return {
      journalBefore,
      journalAfter,
      mount: { projects: mount.projects, ships: mount.ships, violations: mount.violations.length },
      foreignKeyCheckRows: fk.length,
      integrityCheck: integrity,
    };
  }
  finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function removeDbFiles(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${path}${suffix}`;
    if (existsSync(f))
      rmSync(f, { force: true });
  }
}
