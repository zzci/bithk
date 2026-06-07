import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ROOT_DIR } from "@/root";

const DRIZZLE_DIR = resolve(ROOT_DIR, "apps/api/drizzle");

interface Journal {
  readonly entries: readonly { readonly tag: string }[];
}

function readJournal(): Journal {
  return JSON.parse(readFileSync(resolve(DRIZZLE_DIR, "meta/_journal.json"), "utf-8")) as Journal;
}

describe("filesystem migrations", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir && existsSync(workDir))
      rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  it("include the journal sentinel and a .sql file for every journal entry", () => {
    const journal = readJournal();
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries)
      expect(existsSync(resolve(DRIZZLE_DIR, `${entry.tag}.sql`))).toBe(true);
  });

  it("forward-applies into a fresh database", async () => {
    workDir = resolve(tmpdir(), `fs-mig-${process.pid}-${process.hrtime.bigint()}`);
    mkdirSync(workDir, { recursive: true });

    const dbPath = resolve(workDir, "test.db");
    const sqlite = new Database(dbPath, { create: true });
    try {
      const db = drizzle(sqlite);
      await migrate(db, { migrationsFolder: DRIZZLE_DIR });

      const applied = sqlite.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number };
      expect(applied.n).toBe(readJournal().entries.length);

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
