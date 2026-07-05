import type { BackupManifestV2, ManifestColumn, ManifestTable } from "./archive.service";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { seedUser, testNanoid } from "@/shared/test/route-harness";
import { buildLiveSchemaView, runImportDryRun, runImportMerge } from "./import-mapping";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-import-mapping-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
  registerBackupContribution(fileBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

// ─── Cross-schema fixtures: synthetic "old" table defs, live DB target ───

function col(name: string, type = "text", notNull = true, extra: Partial<ManifestColumn> = {}): ManifestColumn {
  return { name, type, notNull, ...extra };
}

function mTable(name: string, module: string, columns: ManifestColumn[], primaryKey: string[] = ["id"]): ManifestTable {
  return { name, module, file: `data/${name}.ndjson`, rowCount: 0, primaryKey, columns };
}

function mManifest(tables: ManifestTable[], modules?: { name: string; deps: string[] }[]): BackupManifestV2 {
  const moduleNames = modules ?? [...new Set(tables.map(t => t.module))].map(name => ({ name, deps: [] }));
  return {
    format: "bithk-backup",
    formatVersion: 2,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: { lastIdx: 0, lastTag: "0000_test", entryCount: 1 } },
    redacted: false,
    includeBlobs: false,
    blobsMode: "none",
    modules: moduleNames,
    tables,
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
  };
}

/** Old-schema `settings` def matching the live table. */
function settingsDef(columns?: ManifestColumn[]): ManifestTable {
  return mTable("settings", "settings", columns ?? [
    col("key"),
    col("value"),
    col("updatedBy", "text", false, { references: "users.id" }),
    col("updatedAt"),
  ], ["key"]);
}

/** Minimal old-schema `users` def — only the NOT NULL no-default columns. */
function usersDef(columns?: ManifestColumn[]): ManifestTable {
  return mTable("users", "users", columns ?? [
    col("id"),
    col("oauthSub"),
    col("username"),
    col("name"),
    col("email"),
  ]);
}

function filesDef(): ManifestTable {
  return mTable("files", "files", [
    col("id"),
    col("sha256"),
    col("size", "integer"),
    col("mimetype"),
    col("storageDriver"),
    col("storageKey"),
    col("refCount", "integer", true, { hasDefault: true }),
    col("uploadedBy", "text", true, { references: "users.id" }),
  ]);
}

function settingsRow(key: string, value = "v"): Record<string, unknown> {
  return { key, value, updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" };
}

function userRow(id: string): Record<string, unknown> {
  return { id, oauthSub: `sub-${id}`, username: `user-${id}`, name: `User ${id}`, email: `${id}@test.com` };
}

function run(manifest: BackupManifestV2, tables: Record<string, Record<string, unknown>[]>) {
  return runImportDryRun(db, manifest, new Map(Object.entries(tables)));
}

/** Deterministic full-content dump — proves the dry-run left no trace. */
async function dbDump(): Promise<string> {
  const names = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  let out = "";
  for (const { name } of names)
    out += name + JSON.stringify(await db.all(sql`SELECT * FROM ${sql.identifier(name)} ORDER BY rowid`));
  return out;
}

describe("buildLiveSchemaView", () => {
  test("describes PK, unique indexes, FKs and column metadata from the registry", () => {
    const view = buildLiveSchemaView();

    const users = view.get("users")!;
    expect(users.primaryKey).toEqual(["id"]);
    expect(users.uniqueIndexes.map(u => u.name)).toContain("idx_users_username");
    expect(users.columns.get("role")!.hasDefault).toBe(true);
    expect(users.columns.get("avatar")!.notNull).toBe(false);

    const files = view.get("files")!;
    expect(files.columns.get("uploadedBy")!.references).toEqual({ table: "users", prop: "id" });
    expect(files.uniqueIndexes.find(u => u.name === "idx_files_sha_driver")!.props).toEqual(["sha256", "storageDriver"]);

    // Composite PK is declared at table level, not on the column.
    expect(view.get("user_preferences")!.primaryKey).toEqual(["userId", "key"]);
    // settings keys by `key`, not `id`.
    expect(view.get("settings")!.primaryKey).toEqual(["key"]);
  });
});

describe("mapping rules (dry-run only)", () => {
  test("rule 1: column in both schemas copies the value", () => {
    const report = run(mManifest([settingsDef()]), { settings: [settingsRow("k1")] });
    const table = report.tables.settings!;
    expect(table.inserted).toBe(1);
    expect(table.transformed).toBe(0);
    expect(table.droppedColumns).toEqual({});
    expect(table.defaultedColumns).toEqual({});
    expect(table.failed.total).toBe(0);
    expect(report.totals).toEqual({ inserted: 1, skippedDuplicate: 0, failed: 0, transformed: 0 });
  });

  test("rule 2: archive-only column is dropped, row kept", () => {
    const def = settingsDef([...settingsDef().columns, col("legacyFlag", "integer", false)]);
    const report = run(mManifest([def]), { settings: [{ ...settingsRow("k1"), legacyFlag: 1 }] });
    expect(report.tables.settings!.inserted).toBe(1);
    expect(report.tables.settings!.droppedColumns).toEqual({ legacyFlag: 1 });
  });

  test("rule 3: new live column with default/NULL is omitted and reported", () => {
    const report = run(mManifest([usersDef()]), { users: [userRow("u1aaaaaa")] });
    const table = report.tables.users!;
    expect(table.inserted).toBe(1);
    // NOT NULL with default → defaulted; nullable → NULL.
    expect(table.defaultedColumns.role).toBe(1);
    expect(table.defaultedColumns.isVirtual).toBe(1);
    expect(table.defaultedColumns.avatar).toBe(1);
  });

  test("rule 5: new live NOT NULL column without default fails the whole table", () => {
    const def = usersDef(usersDef().columns.filter(c => c.name !== "email"));
    const rows = [userRow("u1aaaaaa"), userRow("u2aaaaaa")].map((r) => {
      const { email: _email, ...rest } = r;
      return rest;
    });
    const report = run(mManifest([def]), { users: rows });
    const table = report.tables.users!;
    expect(table.error).toBe("missing-required-column: email");
    expect(table.inserted).toBe(0);
    expect(table.failed.total).toBe(2);
    expect(report.totals.failed).toBe(2);
  });

  test("rule 6: declared type change copies as-is and warns", () => {
    const def = settingsDef(settingsDef().columns.map(c => c.name === "value" ? { ...c, type: "integer" } : c));
    const report = run(mManifest([def]), { settings: [settingsRow("k1")] });
    expect(report.tables.settings!.inserted).toBe(1);
    expect(report.warnings.some(w => w.startsWith("type-changed: settings.value"))).toBe(true);
  });

  test("rule 7: archive table gone from the live schema is skipped", () => {
    const widgets = mTable("widgets", "settings", [col("id"), col("label")]);
    const report = run(mManifest([widgets, settingsDef()]), {
      widgets: [{ id: "w1aaaaaa", label: "x" }],
      settings: [settingsRow("k1")],
    });
    expect(report.skippedTables).toEqual(["widgets"]);
    expect(report.tables.widgets).toBeUndefined();
    expect(report.tables.settings!.inserted).toBe(1);
  });

  test("rule 9: live table absent from the archive is untouched and unreported", async () => {
    await seedUser(db, "admin");
    const before = await dbDump();
    const report = run(mManifest([settingsDef()]), { settings: [settingsRow("k1")] });
    expect(report.tables.users).toBeUndefined();
    expect(await dbDump()).toBe(before);
  });

  test("rule 10: archive module unknown to the registry is skipped wholesale", () => {
    const gadgets = mTable("gadgets", "gizmos", [col("id")]);
    const report = run(
      mManifest([gadgets, settingsDef()], [{ name: "gizmos", deps: [] }, { name: "settings", deps: [] }]),
      { gadgets: [{ id: "g1aaaaaa" }], settings: [settingsRow("k1")] },
    );
    expect(report.skippedModules).toEqual(["gizmos"]);
    expect(report.skippedTables).toEqual([]);
    expect(report.tables.gadgets).toBeUndefined();
    expect(report.tables.settings!.inserted).toBe(1);
  });

  test("rule 11: existing primary key wins — row skipped as duplicate (non-id PK)", async () => {
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k1', 'live', '2026-01-01T00:00:00Z')`);
    const report = run(mManifest([settingsDef()]), { settings: [settingsRow("k1", "incoming"), settingsRow("k2")] });
    const table = report.tables.settings!;
    expect(table.skippedDuplicate).toBe(1);
    expect(table.inserted).toBe(1);
    expect(report.totals.skippedDuplicate).toBe(1);
  });

  test("rule 11: composite primary key probe (user_preferences)", async () => {
    const userId = await seedUser(db, "user");
    await db.run(sql`INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (${userId}, 'theme', 'dark', '2026-01-01T00:00:00Z')`);
    const prefs = mTable("user_preferences", "users", [
      col("userId", "text", true, { references: "users.id" }),
      col("key"),
      col("value"),
      col("updatedAt"),
    ], ["userId", "key"]);
    const report = run(mManifest([prefs]), {
      user_preferences: [
        { userId, key: "theme", value: "light", updatedAt: "2026-01-02T00:00:00Z" },
        { userId, key: "lang", value: "zh", updatedAt: "2026-01-02T00:00:00Z" },
      ],
    });
    expect(report.tables.user_preferences!.skippedDuplicate).toBe(1);
    expect(report.tables.user_preferences!.inserted).toBe(1);
  });

  test("rule 12: FK target absent from live ∪ incoming fails the row before SQL", () => {
    const report = run(mManifest([filesDef()]), {
      files: [{
        id: "f1aaaaaa",
        sha256: "ab".repeat(32),
        size: 1,
        mimetype: "application/octet-stream",
        storageDriver: "local",
        storageKey: "ab/ab/x",
        refCount: 1,
        uploadedBy: "nosuchus",
      }],
    });
    const table = report.tables.files!;
    expect(table.failed.total).toBe(1);
    expect(table.failed.sample).toEqual([{ rowId: "f1aaaaaa", reason: "missing-parent" }]);
    expect(table.inserted).toBe(0);
  });

  test("rule 12: FK satisfied by a parent in the same archive (incoming set)", () => {
    const report = run(mManifest([usersDef(), filesDef()]), {
      users: [userRow("u1aaaaaa")],
      files: [{
        id: "f1aaaaaa",
        sha256: "ab".repeat(32),
        size: 1,
        mimetype: "application/octet-stream",
        storageDriver: "local",
        storageKey: "ab/ab/x",
        refCount: 1,
        uploadedBy: "u1aaaaaa",
      }],
    });
    expect(report.tables.users!.inserted).toBe(1);
    expect(report.tables.files!.inserted).toBe(1);
    expect(report.totals.failed).toBe(0);
  });

  test("rule 11 upgrade: non-PK unique hit under a different PK skips and remaps (FIX-060)", async () => {
    const liveId = await seedUser(db, "user");
    const clash = { ...userRow("u9aaaaaa"), username: `user-${liveId}` };
    const report = run(mManifest([usersDef()]), { users: [clash] });
    const table = report.tables.users!;
    expect(table.inserted).toBe(0);
    expect(table.failed.total).toBe(0);
    expect(table.skippedDuplicate).toBe(1);
    expect(table.remapped).toBe(1);
  });

  test("rule 15: the [REDACTED] sentinel inserts verbatim and warns", () => {
    const report = run(mManifest([settingsDef()]), { settings: [settingsRow("k1", "[REDACTED]")] });
    expect(report.tables.settings!.inserted).toBe(1);
    expect(report.warnings).toContain("redacted-secrets: settings contains 1 redacted value(s)");
  });
});

// ─── FIX-060: unique-key remap + COMMIT safety net ────────────────────────

function fileRow(id: string, uploadedBy: string): Record<string, unknown> {
  return {
    id,
    sha256: id.slice(0, 2).repeat(32),
    size: 1,
    mimetype: "application/octet-stream",
    storageDriver: "local",
    storageKey: `xx/xx/${id}`,
    refCount: 0,
    uploadedBy,
  };
}

function fileRefsDef(): ManifestTable {
  return mTable("file_references", "files", [
    col("id"),
    col("fileId", "text", true, { references: "files.id" }),
    col("ownerType"),
    col("ownerId"),
    col("filename"),
    col("createdBy", "text", true, { references: "users.id" }),
  ]);
}

describe("FIX-060: unique-key remap + COMMIT safety net", () => {
  test("children of a unique-key-remapped parent land under the LIVE id", async () => {
    const liveId = await seedUser(db, "user");
    // Fresh-deploy collision shape: same oauth_sub, different id.
    const incoming = { ...userRow("uAaaaaaa"), oauthSub: `sub-${liveId}` };
    const report = runImportMerge(db, mManifest([usersDef(), filesDef()]), new Map([
      ["users", [incoming]],
      ["files", [fileRow("f1aaaaaa", "uAaaaaaa")]],
    ]));

    expect(report.tables.users!.skippedDuplicate).toBe(1);
    expect(report.tables.users!.remapped).toBe(1);
    expect(report.tables.files!.inserted).toBe(1);
    expect(report.totals.failed).toBe(0);
    const rows = await db.all<{ uploaded_by: string }>(sql`SELECT uploaded_by FROM files`);
    expect(rows).toEqual([{ uploaded_by: liveId }]);
  });

  test("dry-run reports the same remap/skip outcomes as the apply that follows", async () => {
    const liveId = await seedUser(db, "user");
    const incoming = { ...userRow("uAaaaaaa"), oauthSub: `sub-${liveId}` };
    const tables = (): Map<string, Record<string, unknown>[]> => new Map([
      ["users", [incoming]],
      ["files", [fileRow("f1aaaaaa", "uAaaaaaa")]],
    ]);
    const manifest = mManifest([usersDef(), filesDef()]);

    const dryRun = runImportDryRun(db, manifest, tables());
    const applied = runImportMerge(db, manifest, tables());
    expect(applied.tables).toEqual(dryRun.tables);
    expect(applied.totals).toEqual(dryRun.totals);
  });

  test("a parent that never lands: dependents deleted as failed(missing-parent) with cascade, no COMMIT abort", async () => {
    const liveId = await seedUser(db, "user");
    // Broken parent — NOT NULL `name` violates at insert, so the promised
    // users row never lands; the file admitted on that promise must be
    // deleted, and the file_reference pointing at the file cascades.
    const broken = { ...userRow("uBbbbbbb"), name: null };
    const report = runImportMerge(db, mManifest([usersDef(), filesDef(), fileRefsDef()]), new Map([
      ["users", [broken]],
      ["files", [fileRow("f1aaaaaa", "uBbbbbbb")]],
      ["file_references", [{ id: "r1aaaaaa", fileId: "f1aaaaaa", ownerType: "item_attachment", ownerId: "x1", filename: "a.bin", createdBy: liveId }]],
    ]));

    expect(report.tables.users!.failed.total).toBe(1);
    expect(report.tables.files!.inserted).toBe(0);
    expect(report.tables.files!.failed.total).toBe(1);
    expect(report.tables.files!.failed.sample).toEqual([{ rowId: "f1aaaaaa", reason: "missing-parent" }]);
    expect(report.tables.file_references!.inserted).toBe(0);
    expect(report.tables.file_references!.failed.total).toBe(1);
    expect(report.tables.file_references!.failed.sample).toEqual([{ rowId: "r1aaaaaa", reason: "missing-parent" }]);
    expect(await db.all(sql`SELECT * FROM files`)).toHaveLength(0);
    expect(await db.all(sql`SELECT * FROM file_references`)).toHaveLength(0);
  });
});

// ─── Blob-column NDJSON codec (import side) ───────────────────────────────

/** Synthetic blob-carrying live table with a NON-id text PK (FEAT-047 shape). */
const blobFixtures = sqliteTable("blob_fixtures", {
  storageKey: text("storage_key").primaryKey(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  size: integer("size").notNull(),
});

async function setUpBlobFixtures(): Promise<void> {
  await db.run(sql`CREATE TABLE blob_fixtures (storage_key TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL)`);
  registerBackupContribution({ name: "blobtest", tables: [blobFixtures], deps: [] });
}

function blobFixturesDef(): ManifestTable {
  return mTable("blob_fixtures", "blobtest", [
    col("storageKey"),
    col("bytes", "blob"),
    col("size", "integer"),
  ], ["storageKey"]);
}

describe("blob-typed column codec", () => {
  test("base64 strings and the legacy Buffer-JSON shape decode to byte-identical blobs on apply", async () => {
    await setUpBlobFixtures();
    const payload = Buffer.from([0, 1, 2, 250, 251, 255, 10, 13, 34, 92]);

    const report = runImportMerge(db, mManifest([blobFixturesDef()]), new Map([[
      "blob_fixtures",
      [
        // v2 exporter encoding: base64 string.
        { storageKey: "k1", bytes: payload.toString("base64"), size: payload.length },
        // Legacy pre-codec archives: JSON.stringify(Buffer) mangle.
        { storageKey: "k2", bytes: { type: "Buffer", data: [...payload] }, size: payload.length },
      ],
    ]]));

    expect(report.tables.blob_fixtures!.inserted).toBe(2);
    expect(report.totals.failed).toBe(0);

    const rows = await db.select().from(blobFixtures).all();
    const byKey = new Map(rows.map(r => [r.storageKey, r.bytes]));
    expect(Buffer.from(byKey.get("k1")!).equals(payload)).toBe(true);
    expect(Buffer.from(byKey.get("k2")!).equals(payload)).toBe(true);
  });

  test("dry-run inserts decoded blob rows and rolls back cleanly", async () => {
    await setUpBlobFixtures();
    const before = await dbDump();
    const report = run(mManifest([blobFixturesDef()]), {
      blob_fixtures: [{ storageKey: "k1", bytes: Buffer.from("hello").toString("base64"), size: 5 }],
    });
    expect(report.tables.blob_fixtures!.inserted).toBe(1);
    expect(report.totals.failed).toBe(0);
    expect(await dbDump()).toBe(before);
  });

  test("an existing blob-keyed row is still detected as duplicate (probe sees decoded values)", async () => {
    await setUpBlobFixtures();
    await db.insert(blobFixtures).values({ storageKey: "k1", bytes: Buffer.from("live"), size: 4 });
    const report = run(mManifest([blobFixturesDef()]), {
      blob_fixtures: [{ storageKey: "k1", bytes: Buffer.from("incoming").toString("base64"), size: 8 }],
    });
    expect(report.tables.blob_fixtures!.skippedDuplicate).toBe(1);
    expect(report.tables.blob_fixtures!.inserted).toBe(0);
  });
});

describe("dry-run isolation", () => {
  test("DB content is byte-identical after a dry-run that inserted, skipped and failed rows", async () => {
    const liveId = await seedUser(db, "admin");
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k1', 'live', '2026-01-01T00:00:00Z')`);
    const before = await dbDump();

    const report = run(mManifest([usersDef(), settingsDef()]), {
      users: [userRow("u1aaaaaa"), { ...userRow("u2aaaaaa"), username: `user-${liveId}` }],
      settings: [settingsRow("k1"), settingsRow("k2")],
    });

    expect(report.totals.inserted).toBe(2); // u1 + k2
    expect(report.totals.skippedDuplicate).toBe(2); // k1 + u2 username clash (remapped)
    expect(report.totals.failed).toBe(0);
    expect(await dbDump()).toBe(before);
  });

  test("an unexpected engine error still rolls back", async () => {
    const before = await dbDump();
    // A manifest table whose live counterpart exists but rows carry a
    // wildly wrong shape still fails per-row (insert error), never wholesale.
    const report = run(mManifest([settingsDef()]), { settings: [{ key: null, value: null, updatedBy: null, updatedAt: null }] });
    expect(report.tables.settings!.failed.total).toBe(1);
    expect(await dbDump()).toBe(before);
  });
});
