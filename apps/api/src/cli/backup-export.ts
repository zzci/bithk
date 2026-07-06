import type { CliCommand } from "./types";
import { rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { consola } from "consola";

/**
 * Offline `backup:export` — reuses the export archive service against a
 * minimal runtime (open DB + file driver, no workers). Module selection is
 * `--modules` XOR `--exclude`; transitive dependencies are auto-resolved by
 * the archive writer, and an `--exclude` whose dependency is pulled back in
 * is reported as a warning. All backup-service imports stay dynamic so the
 * normal boot path is unaffected. Wires the runtime by hand (not
 * `withRuntime`) because module-name validation must fail BEFORE the DB is
 * touched.
 */
async function runBackupExport(
  out: string,
  opts: { modules?: string; exclude?: string; blobs?: boolean; redacted?: boolean },
): Promise<number> {
  if (opts.modules !== undefined && opts.exclude !== undefined) {
    consola.error("use --modules XOR --exclude");
    return 2;
  }

  const { loadConfig } = await import("../config");
  const { createLogger } = await import("../shared/lib/logger");
  const config = await loadConfig();
  const logger = createLogger(config);

  // Importing app.ts populates every module's backup contribution as a load
  // side-effect (no DB is opened until wireRuntime() is actually called), so
  // getModuleNames() below sees the full registry while bad input still fails
  // before we touch the database.
  const { wireRuntime } = await import("../app");
  const { getModuleNames, resolveModulesWithDeps } = await import("../modules/backup/registry");
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
    const { getBackupStagingRoot } = await import("../modules/backup/export-job.service");
    const stagingDir = resolve(getBackupStagingRoot(config), "cli-export", crypto.randomUUID());
    const { writeArchiveV2 } = await import("../modules/backup/archive.service");
    const result = await writeArchiveV2({
      db,
      modules: requested,
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

export const backupExportCommand: CliCommand = {
  command: "backup:export <out>",
  description: "Export a DB-data backup archive to <out>. --modules XOR --exclude (module-level; transitive deps auto-resolved, excluded deps trigger a warning), --redacted. File bytes are NOT embedded — copy the storage tree/bucket alongside the archive.",
  options: [
    { flag: "--modules <csv>", description: "Only these modules (comma-separated; XOR with --exclude)" },
    { flag: "--exclude <csv>", description: "All modules except these (comma-separated; XOR with --modules)" },
    { flag: "--redacted", description: "Scrub secret-typed fields from the export" },
  ],
  async run(args, opts) {
    // FIX-062: --blobs/--no-blobs removed — accepted, warned, ignored.
    if (opts.blobs !== undefined)
      consola.warn("--blobs/--no-blobs is deprecated and ignored: backups no longer embed file bytes (copy the storage tree/bucket instead)");
    return runBackupExport(args[0]!, opts as { modules?: string; exclude?: string; redacted?: boolean });
  },
};
