import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import cac from "cac";
import { consola } from "consola";
import { BUILD_INFO } from "./build-info";
import { ROOT_DIR } from "./root";

const migrateLog = consola.withTag("migrate");

/**
 * Lightweight CLI dispatcher built on `cac`. Handles non-bootstrap
 * subcommands (version, healthcheck, migrate --check) so a container
 * can run the same binary for both `app` (boot the server) and `app
 * healthcheck` (in-process probe — no curl/wget required in the image).
 *
 * Returns the requested exit code, or `null` when no subcommand
 * matched and the caller should fall through to the normal boot path.
 */
export async function dispatchCliSubcommand(argv: readonly string[]): Promise<number | null> {
  const cli = cac("app");

  let exitCode: number | null = null;

  cli
    .command("healthcheck", "Run an in-process probe against /api/health")
    .action(async () => {
      exitCode = await runHealthcheck();
    });

  cli
    .command("migrate", "Migration utilities")
    .option("--check", "List pending migrations without applying them")
    .action(async (opts: { check?: boolean }) => {
      exitCode = await runMigrateSubcommand(opts);
    });

  cli
    .command(
      "backup:export <out>",
      "Export a backup archive to <out>. --modules XOR --exclude (module-level; transitive deps auto-resolved, excluded deps trigger a warning), --no-blobs, --redacted.",
    )
    .option("--modules <csv>", "Only these modules (comma-separated; XOR with --exclude)")
    .option("--exclude <csv>", "All modules except these (comma-separated; XOR with --modules)")
    .option("--no-blobs", "Do not embed blob bytes in the archive")
    .option("--redacted", "Scrub secret-typed fields from the export")
    .action(async (out: string, opts: { modules?: string; exclude?: string; blobs?: boolean; redacted?: boolean }) => {
      exitCode = await runBackupExport(out, opts);
    });

  cli
    .command(
      "backup:import <archive>",
      "Import a backup archive. --mode merge|replace (default merge), --include-users, --actor-id <id>. Note: --mode replace --include-users requires --actor-id to be an ACTIVE ADMIN present in the backup, otherwise the apply refuses with a lock-out / FK error.",
    )
    .option("--mode <mode>", "merge | replace (default merge)")
    .option("--include-users", "Include users (replace mode v1 semantics)")
    .option("--actor-id <id>", "Synthetic actor id recorded in the audit log")
    .action(async (archive: string, opts: { mode?: string; includeUsers?: boolean; actorId?: string }) => {
      exitCode = await runBackupImport(archive, opts);
    });

  cli.help();
  cli.version(`${BUILD_INFO.version} (${BUILD_INFO.commit}) built ${BUILD_INFO.buildTime}`);

  // Parse without auto-running so we can await async actions and decide
  // whether to fall through to the normal boot path.
  let parsed;
  try {
    parsed = cli.parse([...argv], { run: false });
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  // cac prints help/version itself and unsets matchedCommand for us.
  if (parsed.options.help || parsed.options.version) {
    return 0;
  }

  if (!cli.matchedCommand) {
    return null;
  }

  try {
    await cli.runMatchedCommand();
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  return exitCode;
}

async function runHealthcheck(): Promise<number> {
  // Resolves to whatever HOST/PORT/BASE_PATH the running server is using.
  // The probe goes through the public `/api/health` route so it also
  // exercises the secureHeaders + CORS + request-id stack.
  const port = Number(process.env.PORT ?? "3000");
  const basePath = (process.env.BASE_PATH ?? "").replace(/^\/+|\/+$/g, "");
  const path = basePath ? `/${basePath}/api/health` : "/api/health";
  const url = `http://127.0.0.1:${port}${path}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? 0 : 1;
  }
  catch {
    return 1;
  }
}

async function runMigrateSubcommand(opts: { check?: boolean }): Promise<number> {
  if (!opts.check) {
    consola.error("Usage: app migrate --check");
    return 2;
  }
  const pending = listFsPendingMigrations();
  if (pending === null) {
    migrateLog.error("cannot read drizzle/ folder; check that the binary has access to migrations.");
    return 2;
  }
  if (pending.length === 0) {
    migrateLog.success("no pending migrations.");
    return 0;
  }
  migrateLog.info(`${pending.length} pending migration(s):`);
  for (const m of pending)
    consola.log(`  - ${m}`);
  return 0;
}

/**
 * Offline `backup:export` — reuses the export archive service against a
 * minimal runtime (open DB + file driver, no workers). Module selection is
 * `--modules` XOR `--exclude`; transitive dependencies are auto-resolved by
 * the archive writer, and an `--exclude` whose dependency is pulled back in
 * is reported as a warning. All backup-service imports stay dynamic so the
 * normal boot path is unaffected.
 */
async function runBackupExport(
  out: string,
  opts: { modules?: string; exclude?: string; blobs?: boolean; redacted?: boolean },
): Promise<number> {
  if (opts.modules !== undefined && opts.exclude !== undefined) {
    consola.error("use --modules XOR --exclude");
    return 2;
  }

  const { loadConfig } = await import("./config");
  const { createLogger } = await import("./shared/lib/logger");
  const config = await loadConfig();
  const logger = createLogger(config);

  // Importing app.ts populates every module's backup contribution as a load
  // side-effect (no DB is opened until wireRuntime() is actually called), so
  // getModuleNames() below sees the full registry while bad input still fails
  // before we touch the database.
  const { wireRuntime } = await import("./app");
  const { getModuleNames, resolveModulesWithDeps } = await import("./modules/backup/registry");
  const validNames = getModuleNames();
  const validSet = new Set(validNames);

  let requested: string[];
  const excludedSet = new Set<string>();
  if (opts.modules !== undefined) {
    const names = opts.modules.split(",").map(s => s.trim());
    if (names.includes("")) {
      consola.error("--modules contains an empty entry");
      return 2;
    }
    const unknown = names.filter(n => !validSet.has(n));
    if (unknown.length > 0) {
      consola.error(`unknown module(s): ${unknown.join(", ")}. valid modules: ${validNames.join(", ")}`);
      return 2;
    }
    requested = names;
  }
  else if (opts.exclude !== undefined) {
    const names = opts.exclude.split(",").map(s => s.trim());
    if (names.includes("")) {
      consola.error("--exclude contains an empty entry");
      return 2;
    }
    const unknown = names.filter(n => !validSet.has(n));
    if (unknown.length > 0) {
      consola.error(`unknown module(s): ${unknown.join(", ")}. valid modules: ${validNames.join(", ")}`);
      return 2;
    }
    for (const n of names)
      excludedSet.add(n);
    requested = validNames.filter(n => !excludedSet.has(n));
  }
  else {
    requested = [...validNames];
  }

  // writeArchiveV2 expands deps itself; we resolve here only to warn when an
  // excluded module is dragged back in as someone else's dependency.
  if (excludedSet.size > 0) {
    const pulledBack = resolveModulesWithDeps(requested).filter(n => excludedSet.has(n));
    if (pulledBack.length > 0)
      consola.warn(`excluded module(s) pulled back in as dependencies: ${pulledBack.join(", ")}`);
  }

  const { db, close } = await wireRuntime(config, logger);
  try {
    const { getBackupStagingRoot } = await import("./modules/backup/export-job.service");
    const stagingDir = resolve(getBackupStagingRoot(config), "cli-export", crypto.randomUUID());
    const { writeArchiveV2 } = await import("./modules/backup/archive.service");
    const result = await writeArchiveV2({
      db,
      modules: requested,
      blobsMode: opts.blobs === false ? "none" : "embedded",
      stagingDir,
      appName: config.APP_NAME,
      redacted: opts.redacted === true,
    });
    await Bun.write(out, Bun.file(result.archivePath));
    rmSync(stagingDir, { recursive: true, force: true });
    const outPath = resolve(out);
    const size = result.archiveSize ?? statSync(out).size;
    consola.success(`wrote backup to ${outPath} (${size} bytes)`);
    // Surface manifest warnings (blobs skipped per storage driver, …) — the
    // export still succeeded, but the operator must know what is NOT inside.
    for (const warning of result.manifest.warnings)
      consola.warn(warning);
    return 0;
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  finally {
    await close();
  }
}

/**
 * Offline `backup:import` — reuses prepareImport + startImportApply against a
 * minimal runtime. `--mode replace --include-users` requires `--actor-id` to
 * be an active admin present in the backup, otherwise the apply refuses with a
 * lock-out / FK error. All backup-service imports stay dynamic.
 */
async function runBackupImport(
  archive: string,
  opts: { mode?: string; includeUsers?: boolean; actorId?: string },
): Promise<number> {
  const mode = opts.mode ?? "merge";
  if (mode !== "merge" && mode !== "replace") {
    consola.error("--mode must be one of: merge, replace");
    return 2;
  }

  const { loadConfig } = await import("./config");
  const { createLogger } = await import("./shared/lib/logger");
  const config = await loadConfig();
  const logger = createLogger(config);

  const { wireRuntime } = await import("./app");
  const { db, close } = await wireRuntime(config, logger);
  try {
    const { prepareImport } = await import("./modules/backup/import.service");
    const job = await prepareImport(db, config, Bun.file(archive));
    const { startImportApply } = await import("./modules/backup/import-apply");
    const actor = { id: opts.actorId ?? "cli", name: "cli-import", ip: "127.0.0.1", userAgent: "cli" };
    await startImportApply(db, job, { mode, includeUsers: opts.includeUsers === true, actor }, logger);
    await job.done;
    if (job.state === "completed") {
      const t = job.result!.totals;
      consola.success(
        `import complete: inserted=${t.inserted} skippedDuplicate=${t.skippedDuplicate} failed=${t.failed} transformed=${t.transformed}`,
      );
      return 0;
    }
    consola.error(job.error ?? "import failed");
    return 1;
  }
  catch (err) {
    consola.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  finally {
    await close();
  }
}

/**
 * Compare `drizzle/meta/_journal.json` against the most recently applied
 * migration in `__drizzle_migrations`. We do NOT open the DB at this
 * stage — `migrate --check` is meant to run against a snapshot or in a
 * locked environment where booting is undesired. Reading the journal
 * gives the operator the list of migration tags the binary believes are
 * "the new world"; comparing against the DB happens at boot via the
 * regular migrator, so any divergence shows up there. Returning `null`
 * means the journal could not be read (for example, a packaged release missing
 * its drizzle directory).
 */
function listFsPendingMigrations(): string[] | null {
  const fsMigrationsFolder = resolveMigrationsFolder();
  const journalPath = resolve(fsMigrationsFolder, "meta/_journal.json");
  if (!existsSync(journalPath))
    return null;
  try {
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: { tag: string }[] };
    const entries = journal.entries ?? [];
    const knownTags = new Set(
      readdirSync(fsMigrationsFolder)
        .filter(f => f.endsWith(".sql"))
        .map(f => f.replace(/\.sql$/, "")),
    );
    return entries
      .map(e => e.tag)
      .filter(tag => knownTags.has(tag));
  }
  catch {
    return null;
  }
}

function resolveMigrationsFolder(): string {
  const packaged = resolve(ROOT_DIR, "drizzle");
  if (existsSync(resolve(packaged, "meta/_journal.json")))
    return packaged;
  return resolve(ROOT_DIR, "apps/api/drizzle");
}
