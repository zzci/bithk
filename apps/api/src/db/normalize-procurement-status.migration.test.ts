import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Exercises the data-remap statements in `drizzle/0005_closed_warstar.sql` in
// isolation: seed `items` with the pre-migration procurement statuses (plus an
// issue row that legitimately keeps `cancelled`), run the migration's UPDATE
// statements, and assert the procurement mapping while proving the
// `type='procurement'` scope leaves issue rows untouched. The CREATE TABLE in
// the same migration is exercised by the drizzle migrator elsewhere, so only
// the UPDATE statements are run here.

const MIGRATION_PATH = resolve(import.meta.dir, "../../drizzle/0005_closed_warstar.sql");

function updateStatements(): string[] {
  const raw = readFileSync(MIGRATION_PATH, "utf-8");
  return raw
    .split("--> statement-breakpoint")
    .map(chunk =>
      chunk
        .split("\n")
        .filter(line => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(stmt => stmt.toUpperCase().startsWith("UPDATE"));
}

let sqlite: Database;

beforeEach(() => {
  sqlite = new Database(":memory:", { strict: true });
  sqlite.exec(`CREATE TABLE items (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL
  )`);
  const insert = sqlite.prepare("INSERT INTO items (id, type, status) VALUES (?, ?, ?)");
  // Pre-migration procurement statuses: draft|requested|ordered|received|closed|cancelled.
  insert.run("p-draft", "procurement", "draft");
  insert.run("p-requested", "procurement", "requested");
  insert.run("p-ordered", "procurement", "ordered");
  insert.run("p-received", "procurement", "received");
  insert.run("p-closed", "procurement", "closed");
  insert.run("p-cancelled", "procurement", "cancelled");
  // Issue shares items.status and has its own `cancel` value that must NOT move.
  insert.run("i-cancel", "issue", "cancel");
});

afterEach(() => {
  sqlite.close();
});

describe("0005 procurement status data remap", () => {
  test("remaps draft->requested and closed->accepted, leaving valid statuses + issue rows untouched", () => {
    for (const stmt of updateStatements())
      sqlite.exec(stmt);

    const statusOf = (id: string) =>
      (sqlite.prepare("SELECT status FROM items WHERE id = ?").get(id) as { status: string }).status;

    // remapped
    expect(statusOf("p-draft")).toBe("requested");
    expect(statusOf("p-closed")).toBe("accepted");
    // already-valid procurement statuses stay put
    expect(statusOf("p-requested")).toBe("requested");
    expect(statusOf("p-ordered")).toBe("ordered");
    expect(statusOf("p-received")).toBe("received");
    expect(statusOf("p-cancelled")).toBe("cancelled");
    // type='procurement' scope: the issue row is untouched
    expect(statusOf("i-cancel")).toBe("cancel");
  });

  test("leaves no legacy procurement status values behind", () => {
    for (const stmt of updateStatements())
      sqlite.exec(stmt);

    const legacy = sqlite
      .prepare("SELECT count(*) AS n FROM items WHERE type = 'procurement' AND status IN ('draft', 'closed')")
      .get() as { n: number };
    expect(legacy.n).toBe(0);
  });
});
