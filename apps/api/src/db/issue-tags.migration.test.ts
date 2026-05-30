import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "@/db/schema";

// Replay the on-disk drizzle migrations onto a throwaway in-memory DB (the same
// folder `db/index.ts` uses at boot) and inspect the resulting `issue_tags`
// table. We only read its definition, so FK enforcement is irrelevant here.
const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

async function bootDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return sqlite;
}

describe("issue_tags migration", () => {
  it("creates the issue_tags table on a fresh boot", async () => {
    const sqlite = await bootDb();
    const row = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='issue_tags'")
      .get();
    expect(row).toBeTruthy();
  });

  it("declares a composite primary key on (item_id, tag_id)", async () => {
    const sqlite = await bootDb();
    const pk = sqlite
      .query("SELECT name FROM pragma_table_info('issue_tags') WHERE pk > 0 ORDER BY pk")
      .all() as { name: string }[];
    expect(pk.map(c => c.name)).toEqual(["item_id", "tag_id"]);
  });

  it("cascades on delete for both foreign keys", async () => {
    const sqlite = await bootDb();
    const fks = sqlite
      .query("SELECT \"table\" AS tbl, on_delete AS onDelete FROM pragma_foreign_key_list('issue_tags')")
      .all() as { tbl: string; onDelete: string }[];
    const byTable = Object.fromEntries(fks.map(f => [f.tbl, f.onDelete]));
    expect(byTable.items).toBe("CASCADE");
    expect(byTable.tags).toBe("CASCADE");
  });
});
