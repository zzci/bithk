import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Exercises the data migration `drizzle/0003_normalize_issue_status.sql` in
// isolation: seed `items` with the pre-migration issue statuses (plus a
// procurement row that legitimately keeps `cancelled`), run the migration's
// UPDATE statements, and assert the issue mapping while proving the
// `type='issue'` scope leaves the procurement status untouched.

const MIGRATION_PATH = resolve(import.meta.dir, "../../drizzle/0003_normalize_issue_status.sql");

function migrationStatements(): string[] {
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
    .filter(stmt => stmt.length > 0);
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
  insert.run("i-open", "issue", "open");
  insert.run("i-progress", "issue", "in_progress");
  insert.run("i-done", "issue", "done");
  insert.run("i-cancelled", "issue", "cancelled");
  // Procurement shares items.status and keeps its own `cancelled`.
  insert.run("p-cancelled", "procurement", "cancelled");
});

afterEach(() => {
  sqlite.close();
});

describe("0003_normalize_issue_status data migration", () => {
  test("maps issue statuses and leaves procurement untouched", () => {
    for (const stmt of migrationStatements())
      sqlite.exec(stmt);

    const statusOf = (id: string) =>
      (sqlite.prepare("SELECT status FROM items WHERE id = ?").get(id) as { status: string }).status;

    expect(statusOf("i-open")).toBe("todo");
    expect(statusOf("i-progress")).toBe("working");
    expect(statusOf("i-done")).toBe("done");
    expect(statusOf("i-cancelled")).toBe("cancel");
    // type='issue' scope: the procurement row's `cancelled` is preserved.
    expect(statusOf("p-cancelled")).toBe("cancelled");
  });

  test("leaves no legacy issue status values behind", () => {
    for (const stmt of migrationStatements())
      sqlite.exec(stmt);

    const legacy = sqlite
      .prepare("SELECT count(*) AS n FROM items WHERE type = 'issue' AND status IN ('open', 'in_progress', 'cancelled')")
      .get() as { n: number };
    expect(legacy.n).toBe(0);
  });
});
