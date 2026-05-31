import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "@/db/schema";

// Replay the on-disk drizzle migrations onto a throwaway in-memory DB (the same
// folder `db/index.ts` uses at boot) and inspect the resulting `tags_refs`
// table — the single generic tag-assignment join that replaced the five
// per-domain tables. We only read its definition, so FK enforcement is irrelevant.
const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

async function bootDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return sqlite;
}

describe("tags_refs migration", () => {
  it("creates tags_refs and drops the per-domain join tables on a fresh boot", async () => {
    const sqlite = await bootDb();
    const present = sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='tags_refs'")
      .get();
    expect(present).toBeTruthy();

    const legacy = sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
        + "('project_tags','contact_tags','issue_tags','document_tags','procurement_tags')",
      )
      .all();
    expect(legacy).toEqual([]);
  });

  it("declares a composite primary key on (resource_id, tag_id)", async () => {
    const sqlite = await bootDb();
    const pk = sqlite
      .query("SELECT name FROM pragma_table_info('tags_refs') WHERE pk > 0 ORDER BY pk")
      .all() as { name: string }[];
    expect(pk.map(c => c.name)).toEqual(["resource_id", "tag_id"]);
  });

  it("cascades on delete for tag_id and leaves resource_id without a foreign key", async () => {
    const sqlite = await bootDb();
    const fks = sqlite
      .query("SELECT \"table\" AS tbl, \"from\" AS col, on_delete AS onDelete FROM pragma_foreign_key_list('tags_refs')")
      .all() as { tbl: string; col: string; onDelete: string }[];
    // Exactly one FK: tag_id → tags ON DELETE CASCADE. resource_id is polymorphic
    // (no FK), so resource hard-deletes clean their rows app-level.
    expect(fks).toHaveLength(1);
    expect(fks[0]!.tbl).toBe("tags");
    expect(fks[0]!.col).toBe("tag_id");
    expect(fks[0]!.onDelete).toBe("CASCADE");
  });

  it("declares the tags vocabulary with a type column (renamed from source_type)", async () => {
    const sqlite = await bootDb();
    const cols = sqlite
      .query("SELECT name FROM pragma_table_info('tags')")
      .all() as { name: string }[];
    expect(cols.map(c => c.name)).toContain("type");
    expect(cols.map(c => c.name)).not.toContain("source_type");
  });
});
