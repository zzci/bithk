import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ROOT_DIR } from "../root";
import * as schema from "./schema";

export async function createDb(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(path, { create: true, strict: true });

  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA cache_size = -65536");
  sqlite.exec("PRAGMA mmap_size = 268435456");
  sqlite.exec("PRAGMA temp_store = MEMORY");

  const db = drizzle(sqlite, { schema });

  await runMigrations(db);

  // `PRAGMA optimize` refreshes query-planner statistics; SQLite recommends
  // running it roughly hourly on long-lived connections. An unref'd timer
  // here is the simplest scheduling option: it covers every entrypoint
  // (server, CLI, tests) without coupling to the lode prepare hook, which
  // only fires on staged updates. The unref keeps short-lived processes from
  // being held open by it.
  const optimizeTimer = setInterval(() => sqlite.exec("PRAGMA optimize"), 60 * 60 * 1000);
  optimizeTimer.unref?.();

  return Object.assign(db, {
    close: () => {
      clearInterval(optimizeTimer);
      sqlite.close();
    },
  });
}

async function runMigrations(db: ReturnType<typeof drizzle>) {
  const fsMigrationsFolder = resolveMigrationsFolder();
  const journalPath = resolve(fsMigrationsFolder, "meta/_journal.json");

  if (!existsSync(journalPath)) {
    throw new Error(
      `No migrations available: expected ${journalPath}. `
      + "Packaged releases must include drizzle/. "
      + "Run `bun run package` to rebuild the lode artifact.",
    );
  }

  await migrate(db, { migrationsFolder: fsMigrationsFolder });
}

function resolveMigrationsFolder(): string {
  const packaged = resolve(ROOT_DIR, "drizzle");
  if (existsSync(resolve(packaged, "meta/_journal.json")))
    return packaged;
  return resolve(ROOT_DIR, "apps/api/drizzle");
}

export type AppDatabase = Awaited<ReturnType<typeof createDb>>;

/** The transaction handle passed to `db.transaction(tx => …)` callbacks. */
export type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

/**
 * Result shape returned by `bun:sqlite`'s `Statement.run()`. Drizzle's
 * `bun-sqlite` adapter declares `db.run()` as returning `void` at the type
 * level but threads the underlying `Changes` object through at runtime —
 * cast through this interface where the affected-row count matters.
 */
export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

/**
 * Execute a Drizzle bun-sqlite write statement and return its affected-row
 * metadata. Drizzle types `.run()` / `db.run()` as `void` but threads the
 * underlying bun:sqlite `Changes` object through at runtime (see `RunResult`).
 * Running the write through this helper confines the otherwise-unsafe
 * `as unknown as RunResult` reinterpretation to this single audited spot, so
 * callers read `.changes` / `.lastInsertRowid` without re-casting.
 */
export function runWrite(stmt: () => void): RunResult {
  return stmt() as unknown as RunResult;
}
