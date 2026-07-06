import type { CliCommand } from "./types";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { consola } from "consola";
import { ROOT_DIR } from "../root";

const migrateLog = consola.withTag("migrate");

/**
 * Compare `drizzle/meta/_journal.json` against the migrations shipped next
 * to the binary. We do NOT open the DB at this stage — `migrate --check` is
 * meant to run against a snapshot or in a locked environment where booting
 * is undesired. Reading the journal gives the operator the list of
 * migration tags the binary believes are "the new world"; comparing against
 * the DB happens at boot via the regular migrator. Returning `null` means
 * the journal could not be read (for example, a packaged release missing
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

export const migrateCommand: CliCommand = {
  command: "migrate",
  description: "Migration utilities",
  options: [{ flag: "--check", description: "List pending migrations without applying them" }],
  async run(_args, opts) {
    if (opts.check !== true) {
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
  },
};
