import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ROOT_DIR } from "../root";
import { embeddedMigrations } from "./embedded-migrations";
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

  return Object.assign(db, {
    close: () => sqlite.close(),
  });
}

async function runMigrations(db: ReturnType<typeof drizzle>) {
  const fsMigrationsFolder = resolve(ROOT_DIR, "apps/api/drizzle");
  const journalPath = resolve(fsMigrationsFolder, "meta/_journal.json");

  if (existsSync(journalPath)) {
    await migrate(db, { migrationsFolder: fsMigrationsFolder });
    return;
  }

  // Compile path: `scripts/compile.ts` writes the migration files into
  // `embedded-migrations.ts` before invoking `bun build --compile`, then
  // restores the stub. A binary built outside that script — or a binary
  // built from a worktree where the stub was restored but `drizzle/` was
  // excluded — would otherwise boot with an empty map and crash later on
  // its first DB write. Fail fast with a concrete fix.
  if (embeddedMigrations.size === 0) {
    throw new Error(
      "No migrations available: filesystem drizzle/ folder is missing and the "
      + "compiled binary has no embedded migrations. This binary was built "
      + "outside `bun run compile` (which populates embedded-migrations.ts at "
      + "build time) or against a worktree without `apps/api/drizzle/`. Run "
      + "`bun run compile` to rebuild, or mount the project's drizzle/ folder.",
    );
  }

  // Migration journal sentinel — when present in the embedded map it
  // proves the compile step finished writing the full set, not just a
  // truncated prefix. Drizzle's migrator reads it first, so a missing
  // journal here would silently no-op.
  if (!embeddedMigrations.has("meta/_journal.json")) {
    throw new Error(
      "Embedded migrations are corrupt: meta/_journal.json missing. "
      + "Rebuild the binary with `bun run compile`.",
    );
  }

  const tmpMigrations = resolve(tmpdir(), `app-migrations-${process.pid}`);
  try {
    mkdirSync(resolve(tmpMigrations, "meta"), { recursive: true });
    for (const [name, content] of embeddedMigrations) {
      const filePath = resolve(tmpMigrations, name);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    await migrate(db, { migrationsFolder: tmpMigrations });
  }
  finally {
    rmSync(tmpMigrations, { recursive: true, force: true });
  }
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
