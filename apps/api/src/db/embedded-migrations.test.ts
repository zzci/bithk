import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Glob } from "bun";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ROOT_DIR } from "@/root";
import { embeddedMigrations } from "./embedded-migrations";

// Mirror `scripts/compile.ts`: build the embedded map from the on-disk drizzle
// folder (relative keys, sorted) — the exact bytes `bun run compile` bakes into
// the binary. Testing this map proves the bundle is complete and forward-applies
// without having to actually compile a binary.
const DRIZZLE_DIR = resolve(ROOT_DIR, "apps/api/drizzle");

interface Journal {
  readonly entries: readonly { readonly tag: string }[];
}

async function buildEmbeddedMap(): Promise<Map<string, string>> {
  const files: string[] = [];
  const glob = new Glob("**/*");
  for await (const entry of glob.scan({ cwd: DRIZZLE_DIR, onlyFiles: true }))
    files.push(entry);
  files.sort();

  const map = new Map<string, string>();
  for (const file of files)
    map.set(file, readFileSync(resolve(DRIZZLE_DIR, file), "utf-8"));
  return map;
}

describe("embedded migrations bundle", () => {
  it("ships as an empty Map stub at rest (populated only by `bun run compile`)", () => {
    expect(embeddedMigrations).toBeInstanceOf(Map);
    expect(embeddedMigrations.size).toBe(0);
  });

  it("includes the journal sentinel and a .sql file for every journal entry", async () => {
    const map = await buildEmbeddedMap();
    expect(map.size).toBeGreaterThan(0);
    expect(map.has("meta/_journal.json")).toBe(true);

    const journal = JSON.parse(map.get("meta/_journal.json")!) as Journal;
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries)
      expect(map.has(`${entry.tag}.sql`)).toBe(true);
  });
});

describe("embedded migrations apply path", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir && existsSync(workDir))
      rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  it("forward-applies the embedded map into a fresh database", async () => {
    const map = await buildEmbeddedMap();
    workDir = resolve(tmpdir(), `embedded-mig-${process.pid}-${process.hrtime.bigint()}`);
    const migrationsDir = resolve(workDir, "migrations");

    // Materialize the map to disk exactly as `runMigrations` does on the
    // compiled-binary code path, then run the same drizzle migrator.
    for (const [name, content] of map) {
      const filePath = resolve(migrationsDir, name);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }

    const dbPath = resolve(workDir, "test.db");
    const sqlite = new Database(dbPath, { create: true });
    try {
      const db = drizzle(sqlite);
      await migrate(db, { migrationsFolder: migrationsDir });

      // Every journal migration recorded as applied on the fresh DB.
      const journal = JSON.parse(map.get("meta/_journal.json")!) as Journal;
      const applied = sqlite.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number };
      expect(applied.n).toBe(journal.entries.length);

      // Representative business tables exist after the bundle applies.
      for (const table of ["users", "contacts", "relation_tuples"]) {
        const row = sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        expect(row).not.toBeNull();
      }
    }
    finally {
      sqlite.close();
    }
  });
});
