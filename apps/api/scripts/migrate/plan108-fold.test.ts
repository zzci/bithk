import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PROJECT_PRESETS } from "@/modules/project/section.registry";
import { nanoid } from "@/shared/lib/id";
import { PRE_FOLD_BASELINE_HASH, runFold, sha256File } from "./plan108-fold.lib";
import { formatFoldReport } from "./plan108-fold.report";
import { rewriteModuleList, rewriteScopes } from "./plan108-fold.transforms";
import { FoldError } from "./plan108-fold.types";

// A hand-written slice of the PRE-FOLD schema (the old baseline
// `0000_fluffy_zaladane.sql`, no longer in the repo). Only the tables the fold
// rules touch, plus the users/files they reference; every other table is
// simply absent from the source, which the fold allows. CREATE TABLE text is
// the old baseline's, re-indented.
const OLD_DDL = `
CREATE TABLE \`users\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`oauth_sub\` text NOT NULL,
  \`username\` text NOT NULL,
  \`name\` text NOT NULL,
  \`email\` text NOT NULL,
  \`avatar\` text,
  \`role\` text DEFAULT 'user' NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`is_virtual\` integer DEFAULT false NOT NULL,
  \`last_login_at\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL
);
CREATE TABLE \`files\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`sha256\` text NOT NULL,
  \`size\` integer NOT NULL,
  \`mimetype\` text NOT NULL,
  \`storage_driver\` text NOT NULL,
  \`storage_key\` text NOT NULL,
  \`ref_count\` integer DEFAULT 0 NOT NULL,
  \`uploaded_by\` text NOT NULL,
  FOREIGN KEY (\`uploaded_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE \`file_blob\` (
  \`storage_key\` text PRIMARY KEY NOT NULL,
  \`content\` blob NOT NULL,
  \`created_at\` text NOT NULL
);
CREATE TABLE \`file_references\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`file_id\` text NOT NULL,
  \`owner_type\` text NOT NULL,
  \`owner_id\` text NOT NULL,
  \`filename\` text NOT NULL,
  \`metadata\` text DEFAULT '{}' NOT NULL,
  \`created_by\` text NOT NULL,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`file_id\`) REFERENCES \`files\`(\`id\`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (\`created_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX \`idx_file_refs_unique\` ON \`file_references\` (\`owner_type\`,\`owner_id\`,\`file_id\`);
CREATE TABLE \`projects\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`short_id\` text NOT NULL,
  \`code\` text NOT NULL,
  \`name\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`description\` text,
  \`ship_id\` text,
  \`cover_reference_id\` text,
  \`creator_id\` text NOT NULL,
  \`version\` integer DEFAULT 1 NOT NULL,
  \`deleted_at\` text,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`ship_id\`) REFERENCES \`ships\`(\`id\`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (\`cover_reference_id\`) REFERENCES \`file_references\`(\`id\`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (\`creator_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX \`projects_short_id_idx\` ON \`projects\` (\`short_id\`);
CREATE UNIQUE INDEX \`projects_code_idx\` ON \`projects\` (\`code\`);
CREATE TABLE \`ships\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`short_id\` text NOT NULL,
  \`code\` text NOT NULL,
  \`name\` text NOT NULL,
  \`status\` text DEFAULT 'laid_up' NOT NULL,
  \`base_project_id\` text,
  \`model\` text,
  \`builder\` text,
  \`build_year\` integer,
  \`length_overall\` real,
  \`beam\` real,
  \`draft\` real,
  \`air_draft\` real,
  \`gross_tonnage\` real,
  \`imo_number\` text,
  \`mmsi\` text,
  \`call_sign\` text,
  \`flag_state\` text,
  \`registry_port\` text,
  \`owner_name\` text,
  \`description\` text,
  \`cover_reference_id\` text,
  \`creator_id\` text NOT NULL,
  \`version\` integer DEFAULT 1 NOT NULL,
  \`deleted_at\` text,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`base_project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (\`cover_reference_id\`) REFERENCES \`file_references\`(\`id\`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (\`creator_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX \`ships_code_idx\` ON \`ships\` (\`code\`);
CREATE TABLE \`ship_equipment_categories\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`ship_id\` text NOT NULL,
  \`name_zh\` text NOT NULL,
  \`name_en\` text NOT NULL,
  \`code\` text,
  \`description\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`ship_id\`) REFERENCES \`ships\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE \`ship_equipment\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`ship_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`category_id\` text,
  \`manufacturer_id\` text,
  \`model\` text,
  \`serial_number\` text,
  \`location\` text,
  \`installed_at\` text,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`note\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`ship_id\`) REFERENCES \`ships\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (\`category_id\`) REFERENCES \`ship_equipment_categories\`(\`id\`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE \`worklists\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`ship_id\` text,
  \`name\` text NOT NULL,
  \`checklist\` text,
  \`precautions\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`ship_id\`) REFERENCES \`ships\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE \`tags\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`type\` text NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL
);
CREATE UNIQUE INDEX \`tags_type_name_idx\` ON \`tags\` (\`type\`,\`name\`);
CREATE TABLE \`tags_refs\` (
  \`resource_id\` text NOT NULL,
  \`tag_id\` text NOT NULL,
  PRIMARY KEY(\`resource_id\`, \`tag_id\`),
  FOREIGN KEY (\`tag_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE \`groups\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`name\` text NOT NULL,
  \`description\` text,
  \`modules\` text DEFAULT '[]' NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL
);
CREATE TABLE \`settings\` (
  \`key\` text PRIMARY KEY NOT NULL,
  \`value\` text NOT NULL,
  \`updated_by\` text,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`updated_by\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE \`api_tokens\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`token_hash\` text NOT NULL,
  \`prefix\` text NOT NULL,
  \`scopes\` text DEFAULT '{}' NOT NULL,
  \`expires_at\` text NOT NULL,
  \`last_used_at\` text,
  \`revoked_at\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at numeric
);
`;

const T = "2026-01-01T00:00:00.000Z";
const SHIP_UPDATED = "2026-01-02T00:00:00.000Z";
const BLOB = new Uint8Array([1, 2, 3, 250, 0, 7]);

interface FixtureOptions {
  /** Add a LIVE ship with no base project -- the hard error the fold exists to catch. */
  readonly liveShipWithoutBase?: boolean;
  readonly journalHash?: string;
}

function buildSource(path: string, opts: FixtureOptions = {}): void {
  const db = new Database(path, { create: true });
  try {
    db.exec(OLD_DDL);
    db.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [opts.journalHash ?? PRE_FOLD_BASELINE_HASH, 1783147270852]);
    db.run("INSERT INTO users (id, oauth_sub, username, name, email, role, status, is_virtual, created_at, updated_at) VALUES ('u1', 'test|u1', 'u1', 'User One', 'u1@example.com', 'admin', 'active', 0, ?, ?)", [T, T]);

    const file = (id: string, driver: string) =>
      db.run("INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by) VALUES (?, ?, 10, 'image/png', ?, ?, 1, 'u1')", [id, `sha-${id}`, driver, `key-${id}`]);
    file("f1", "s3");
    file("f2", "s3");
    file("f3", "local");
    db.run("INSERT INTO file_blob (storage_key, content, created_at) VALUES ('key-blob', ?, ?)", [BLOB, T]);

    const ref = (id: string, fileId: string, ownerType: string, ownerId: string) =>
      db.run("INSERT INTO file_references (id, file_id, owner_type, owner_id, filename, metadata, created_by, created_at) VALUES (?, ?, ?, ?, 'cover.png', '{}', 'u1', ?)", [id, fileId, ownerType, ownerId, T]);
    ref("ref-s1", "f1", "ship_cover", "s1");
    ref("ref-pb", "f2", "project_cover", "pB");
    ref("ref-s2", "f2", "ship_cover", "s2");
    ref("ref-s3", "f3", "ship_cover", "s3");

    const project = (id: string, name: string, description: string | null, shipId: string | null, cover: string | null, deletedAt: string | null = null) =>
      db.run("INSERT INTO projects (id, short_id, code, name, status, description, ship_id, cover_reference_id, creator_id, version, deleted_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'u1', 1, ?, ?)", [id, `s-${id}`, id.toLowerCase(), name, description, shipId, cover, deletedAt, T]);
    project("pA", "Alpha", "Alpha desc", "s1", null);
    project("pB", "Bravo", null, "s2", "ref-pb");
    project("pC", "Charlie sub", null, "s1", null);
    project("pD", "Delta", "", null, null);
    project("pE", "Echo (deleted)", null, null, null, T);

    const ship = (id: string, code: string, name: string, status: string, base: string | null, description: string | null, cover: string | null, deletedAt: string | null) =>
      db.run("INSERT INTO ships (id, short_id, code, name, status, base_project_id, build_year, length_overall, description, cover_reference_id, creator_id, version, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 2019, 42.5, ?, ?, 'u1', 1, ?, ?)", [id, `s-${id}`, code, name, status, base, description, cover, deletedAt, SHIP_UPDATED]);
    ship("s1", "HULL-1", "Alpha", "active", "pA", "S1 desc", "ref-s1", null);
    ship("s2", "HULL-2", "Bravo II", "laid_up", "pB", "S2 desc", "ref-s2", null);
    ship("s3", "HULL-3", "Ghost", "retired", null, null, null, T);
    if (opts.liveShipWithoutBase)
      ship("s4", "HULL-4", "Orphan", "active", null, null, null, null);

    db.run("INSERT INTO ship_equipment_categories (id, ship_id, name_zh, name_en, created_at, updated_at) VALUES ('c1', 's1', 'Engine (zh)', 'Engine', ?, ?)", [T, T]);
    db.run("INSERT INTO ship_equipment (id, ship_id, name, category_id, status, created_at, updated_at) VALUES ('e1', 's1', 'Main engine', 'c1', 'active', ?, ?)", [T, T]);
    db.run("INSERT INTO ship_equipment (id, ship_id, name, category_id, status, created_at, updated_at) VALUES ('e2', 's1', 'Radar', NULL, 'active', ?, ?)", [T, T]);
    db.run("INSERT INTO worklists (id, ship_id, name, created_at, updated_at) VALUES ('w1', NULL, 'Global list', ?, ?)", [T, T]);
    db.run("INSERT INTO worklists (id, ship_id, name, created_at, updated_at) VALUES ('w2', 's1', 'Ship list', ?, ?)", [T, T]);

    const tag = (id: string, name: string, type: string) =>
      db.run("INSERT INTO tags (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [id, name, type, T, T]);
    tag("t-alpha", "alpha", "ship");
    tag("t-beta-ship", "beta", "ship");
    tag("t-beta-proj", "beta", "project");
    tag("t-urgent", "urgent", "issue");
    const tagRef = (resourceId: string, tagId: string) =>
      db.run("INSERT INTO tags_refs (resource_id, tag_id) VALUES (?, ?)", [resourceId, tagId]);
    tagRef("s1", "t-alpha");
    tagRef("s2", "t-beta-ship");
    tagRef("pB", "t-beta-proj");
    tagRef("s3", "t-alpha");
    tagRef("pD", "t-beta-proj");

    db.run("INSERT INTO groups (id, name, modules, created_at, updated_at) VALUES ('g1', 'Group One', '[\"documents\",\"ships\"]', ?, ?)", [T, T]);
    db.run("INSERT INTO groups (id, name, modules, created_at, updated_at) VALUES ('g2', 'Group Two', '[\"projects\",\"ships\"]', ?, ?)", [T, T]);
    db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('account.default_modules', '[\"ships\",\"drive\"]', 'u1', ?)", [T]);
    db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('app.display_name', 'Fixture', NULL, ?)", [T]);
    db.run("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at, created_at) VALUES ('k1', 'u1', 'Token', 'hash-k1', 'bit_k1', '{\"ships\":\"write\",\"projects\":\"read\"}', ?, ?)", [T, T]);
    db.run("INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scopes, expires_at, created_at) VALUES ('k2', 'u1', 'Token 2', 'hash-k2', 'bit_k2', '{\"ships\":\"read\"}', ?, ?)", [T, T]);
  }
  finally {
    db.close();
  }
}

let dir: string;
let from: string;
let to: string;

beforeEach(() => {
  dir = resolve(tmpdir(), `test-plan108-fold-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  from = resolve(dir, "source.db");
  to = resolve(dir, "target.db");
});

afterEach(() => {
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

function openTarget(): Database {
  return new Database(to, { readonly: true });
}

function rows<T>(db: Database, query: string, ...params: (string | number)[]): T[] {
  return db.query(query).all(...params) as T[];
}

function row<T>(db: Database, query: string, ...params: (string | number)[]): T {
  const r = db.query(query).get(...params) as T | null;
  if (r === null)
    throw new Error(`no row for ${query}`);
  return r;
}

describe("plan108-fold", () => {
  test("folds the fixture: sections, profiles, reparenting, tags, covers, modules", async () => {
    buildSource(from);
    const sourceBefore = await sha256File(from);

    const report = await runFold({ from, to });

    expect(await sha256File(from)).toBe(sourceBefore);
    expect(report.sourceSha256After).toBe(sourceBefore);
    expect(existsSync(to)).toBe(true);

    const db = openTarget();
    try {
      // Rule 1: every project (including the soft-deleted one) carries its preset in order.
      const sectionsOf = (id: string) => rows<{ key: string }>(db, "SELECT key FROM project_sections WHERE project_id = ? ORDER BY sort_order", id).map(r => r.key);
      expect(sectionsOf("pA")).toEqual([...PROJECT_PRESETS.ship]);
      expect(sectionsOf("pB")).toEqual([...PROJECT_PRESETS.ship]);
      expect(sectionsOf("pC")).toEqual([...PROJECT_PRESETS.general]);
      expect(sectionsOf("pD")).toEqual([...PROJECT_PRESETS.general]);
      expect(sectionsOf("pE")).toEqual([...PROJECT_PRESETS.general]);
      expect(rows<{ sort_order: number }>(db, "SELECT sort_order FROM project_sections WHERE project_id = 'pA' ORDER BY sort_order").map(r => r.sort_order)).toEqual([0, 10, 20, 30, 40, 50]);
      expect(report.sections).toEqual({ rows: 21, shipProjects: 2, generalProjects: 3, other: [] });

      // Rule 2: one profile per folded ship, keyed by the base project.
      const profiles = rows<{ project_id: string; hull_number: string; ship_status: string; build_year: number; length_overall: number; created_at: string; updated_at: string }>(
        db,
        "SELECT project_id, hull_number, ship_status, build_year, length_overall, created_at, updated_at FROM ship_profiles ORDER BY project_id",
      );
      expect(profiles).toEqual([
        { project_id: "pA", hull_number: "HULL-1", ship_status: "active", build_year: 2019, length_overall: 42.5, created_at: SHIP_UPDATED, updated_at: SHIP_UPDATED },
        { project_id: "pB", hull_number: "HULL-2", ship_status: "laid_up", build_year: 2019, length_overall: 42.5, created_at: SHIP_UPDATED, updated_at: SHIP_UPDATED },
      ]);
      expect(report.ships.folded).toBe(2);
      expect(report.ships.skipped).toEqual([{ id: "s3", code: "HULL-3", name: "Ghost", deletedAt: T }]);
      expect(report.ships.nameMismatches).toEqual([{ shipId: "s2", shipName: "Bravo II", projectId: "pB", projectName: "Bravo" }]);
      expect(report.ships.descriptionsFilled).toEqual(["pB"]);
      const projects = rows<{ id: string; name: string; description: string | null; parent_id: string | null; cover_reference_id: string | null }>(
        db,
        "SELECT id, name, description, parent_id, cover_reference_id FROM projects ORDER BY id",
      );
      expect(projects).toEqual([
        { id: "pA", name: "Alpha", description: "Alpha desc", parent_id: null, cover_reference_id: "ref-s1" },
        { id: "pB", name: "Bravo", description: "S2 desc", parent_id: null, cover_reference_id: "ref-pb" },
        { id: "pC", name: "Charlie sub", description: null, parent_id: "pA", cover_reference_id: null },
        { id: "pD", name: "Delta", description: "", parent_id: null, cover_reference_id: null },
        { id: "pE", name: "Echo (deleted)", description: null, parent_id: null, cover_reference_id: null },
      ]);
      expect(rows<{ name: string }>(db, "PRAGMA table_info(projects)").map(c => c.name)).not.toContain("ship_id");
      expect(report.parents).toEqual([{ projectId: "pC", parentId: "pA" }]);

      // Rule 3: equipment, categories and worklists move to the base project.
      expect(rows(db, "SELECT id, project_id, category_id FROM ship_equipment ORDER BY id")).toEqual([
        { id: "e1", project_id: "pA", category_id: "c1" },
        { id: "e2", project_id: "pA", category_id: null },
      ]);
      expect(rows(db, "SELECT id, project_id FROM ship_equipment_categories")).toEqual([{ id: "c1", project_id: "pA" }]);
      expect(rows(db, "SELECT id, project_id FROM worklists ORDER BY id")).toEqual([
        { id: "w1", project_id: null },
        { id: "w2", project_id: "pA" },
      ]);

      // Rule 4: ship tags become project tags; the colliding one is merged.
      expect(rows(db, "SELECT id, name, type FROM tags ORDER BY id")).toEqual([
        { id: "t-alpha", name: "alpha", type: "project" },
        { id: "t-beta-proj", name: "beta", type: "project" },
        { id: "t-urgent", name: "urgent", type: "issue" },
      ]);
      expect(rows(db, "SELECT resource_id, tag_id FROM tags_refs ORDER BY resource_id, tag_id")).toEqual([
        { resource_id: "pA", tag_id: "t-alpha" },
        { resource_id: "pB", tag_id: "t-beta-proj" },
        { resource_id: "pD", tag_id: "t-beta-proj" },
      ]);
      expect(report.tags).toEqual({ renamed: [{ id: "t-alpha", name: "alpha" }], merged: [{ id: "t-beta-ship", name: "beta", into: "t-beta-proj" }] });
      const tagRefs = report.tables.find(t => t.table === "tags_refs")!;
      // 5 source refs: 2 verbatim project refs + 1 rewritten ship ref written; the merged-duplicate and skipped-ship refs skipped.
      expect(tagRefs).toMatchObject({ source: 5, written: 3, rewritten: 1, skipped: 2 });
      expect(tagRefs.skips).toEqual([
        { reason: "duplicate of (pB, t-beta-proj)", ids: ["s2/t-beta-ship"] },
        { reason: "ship was skipped or unknown", ids: ["s3/t-alpha"] },
      ]);
      expect(report.tables.find(t => t.table === "tags")).toMatchObject({ source: 4, written: 3, rewritten: 1, skipped: 1 });

      // Rule 5: covers -- gained, retained as duplicate, retained because the ship was skipped.
      expect(rows(db, "SELECT id, owner_type, owner_id FROM file_references ORDER BY id")).toEqual([
        { id: "ref-pb", owner_type: "project_cover", owner_id: "pB" },
        { id: "ref-s1", owner_type: "project_cover", owner_id: "pA" },
        { id: "ref-s2", owner_type: "ship_cover", owner_id: "s2" },
        { id: "ref-s3", owner_type: "ship_cover", owner_id: "s3" },
      ]);
      expect(report.covers.gained).toEqual([{ refId: "ref-s1", fileId: "f1", shipId: "s1", projectId: "pA" }]);
      expect(report.covers.displaced).toEqual([]);
      expect(report.covers.retainedDuplicate).toEqual([{ refId: "ref-s2", fileId: "f2", shipId: "s2", projectId: "pB", existingRefId: "ref-pb" }]);
      expect(report.covers.retainedShipSkipped).toEqual([{ refId: "ref-s3", fileId: "f3", shipId: "s3", projectId: "" }]);
      expect(report.tables.find(t => t.table === "file_references")).toMatchObject({ source: 4, written: 4, rewritten: 1, skipped: 0 });

      // Rule 7: module rename, merged not appended, on all three carriers.
      expect(rows(db, "SELECT id, modules FROM groups ORDER BY id")).toEqual([
        { id: "g1", modules: "[\"documents\",\"projects\"]" },
        { id: "g2", modules: "[\"projects\"]" },
      ]);
      expect(row<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'account.default_modules'").value).toBe("[\"projects\",\"drive\"]");
      expect(row<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'app.display_name'").value).toBe("Fixture");
      expect(rows(db, "SELECT id, scopes FROM api_tokens ORDER BY id")).toEqual([
        { id: "k1", scopes: "{\"projects\":\"write\"}" },
        { id: "k2", scopes: "{\"projects\":\"read\"}" },
      ]);
      expect(report.modules.groups).toHaveLength(2);
      expect(report.modules.defaultModules).toEqual({ id: "account.default_modules", before: "[\"ships\",\"drive\"]", after: "[\"projects\",\"drive\"]" });
      expect(report.modules.apiTokens).toHaveLength(2);

      // Rule 8: verbatim tables, including blob bytes and the local-blob listing.
      expect(row<{ content: Uint8Array }>(db, "SELECT content FROM file_blob WHERE storage_key = 'key-blob'").content).toEqual(BLOB);
      expect(row<{ n: number }>(db, "SELECT count(*) AS n FROM users").n).toBe(1);
      expect(report.localBlobs).toEqual([{ id: "f3", sha256: "sha-f3", storageKey: "key-f3", size: 10 }]);
      expect(report.tables.find(t => t.table === "ships")).toBeUndefined();
      expect(report.ignoredSourceTables).toEqual(["__drizzle_migrations"]);
      expect(rows(db, "SELECT count(*) AS n FROM __drizzle_migrations")).toEqual([{ n: report.targetJournal.length }]);
      expect(row<{ n: number }>(db, "SELECT count(*) AS n FROM webhooks").n).toBe(0);
      expect(report.tables.find(t => t.table === "webhooks")).toMatchObject({ source: null, written: 0, note: "not in source" });
      for (const t of report.tables) {
        if (t.source !== null)
          expect(t.source - t.written - t.skipped - t.consumed).toBe(0);
      }
    }
    finally {
      db.close();
    }

    // Self-check: migrate no-op, mount integrity, FK and integrity checks.
    expect(report.selfCheck.mount).toEqual({ projects: 4, ships: 2, violations: 0 });
    expect(report.selfCheck.journalAfter).toEqual(report.selfCheck.journalBefore);
    expect(report.selfCheck.foreignKeyCheckRows).toBe(0);
    expect(report.selfCheck.integrityCheck).toBe("ok");
    expect(report.selfCheck.walBytes === null || report.selfCheck.walBytes === 0).toBe(true);

    const text = formatFoldReport(report);
    expect(text).toContain("FOLD OK");
    expect(text).toContain("HULL-3");
    expect(text).not.toContain("hash-k1");
  });

  test("a live ship without a base project aborts and leaves no target behind", async () => {
    buildSource(from, { liveShipWithoutBase: true });
    const sourceBefore = await sha256File(from);

    const err = await runFold({ from, to }).catch(e => e);
    expect(err).toBeInstanceOf(FoldError);
    expect((err as Error).message).toContain("live ship without base project: s4");
    expect(existsSync(to)).toBe(false);
    expect(existsSync(`${to}-wal`)).toBe(false);
    expect(await sha256File(from)).toBe(sourceBefore);
  });

  test("an existing target is refused without --force and replaced with it", async () => {
    buildSource(from);
    writeFileSync(to, "keep me");
    const targetBefore = await sha256File(to);
    const sourceBefore = await sha256File(from);

    const err = await runFold({ from, to }).catch(e => e);
    expect(err).toBeInstanceOf(FoldError);
    expect((err as Error).message).toContain("already exists");
    expect(await sha256File(to)).toBe(targetBefore);
    expect(await sha256File(from)).toBe(sourceBefore);

    const report = await runFold({ from, to, force: true });
    expect(report.ships.folded).toBe(2);
    expect(await sha256File(to)).not.toBe(targetBefore);
    expect(await sha256File(from)).toBe(sourceBefore);
  });

  test("refuses a source whose journal is not the pre-fold baseline", async () => {
    buildSource(from, { journalHash: "0".repeat(64) });
    const err = await runFold({ from, to }).catch(e => e);
    expect(err).toBeInstanceOf(FoldError);
    expect((err as Error).message).toContain("not the pre-fold baseline");
    expect(existsSync(to)).toBe(false);
  });

  test("refuses when --from and --to are the same file", async () => {
    buildSource(from);
    await expect(runFold({ from, to: from })).rejects.toThrow("same file");
  });
});

describe("module rename helpers", () => {
  test("rewriteModuleList replaces or merges ships", () => {
    expect(rewriteModuleList("[\"documents\",\"ships\"]")).toBe("[\"documents\",\"projects\"]");
    expect(rewriteModuleList("[\"projects\",\"ships\",\"drive\"]")).toBe("[\"projects\",\"drive\"]");
    expect(rewriteModuleList("[\"drive\"]")).toBeNull();
    expect(rewriteModuleList("not json")).toBeNull();
    expect(rewriteModuleList("{\"ships\":1}")).toBeNull();
  });

  test("rewriteScopes renames the key and keeps the higher level", () => {
    expect(rewriteScopes("{\"ships\":\"write\",\"projects\":\"read\"}")).toBe("{\"projects\":\"write\"}");
    expect(rewriteScopes("{\"projects\":\"write\",\"ships\":\"read\"}")).toBe("{\"projects\":\"write\"}");
    expect(rewriteScopes("{\"drive\":\"read\",\"ships\":\"read\"}")).toBe("{\"drive\":\"read\",\"projects\":\"read\"}");
    expect(rewriteScopes("{\"drive\":\"read\"}")).toBeNull();
    expect(rewriteScopes("[]")).toBeNull();
  });
});
