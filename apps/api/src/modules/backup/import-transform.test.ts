/**
 * Phase 4 transform-hook tests (PLAN-075): rule 4 (importFallbacks), rule 8
 * (vanished-table re-home via importTransforms), the rename+NOT-NULL
 * combination, `appliesTo` gating, and dry-run==apply report parity with
 * hooks active. Rule 14 (files sha-remap) is covered by the owning module in
 * `modules/file/file.backup.test.ts`.
 */
import type { BackupManifestV2, ManifestColumn, ManifestTable } from "./archive.service";
import type { BackupContribution } from "./registry";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { testNanoid } from "@/shared/test/route-harness";
import { runImportDryRun, runImportMerge } from "./import-mapping";
import { __resetBackupRegistryForTests, getImportFallbacksByTable, getImportTransformsByTable, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-import-transform-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

function col(name: string, type = "text", notNull = true, extra: Partial<ManifestColumn> = {}): ManifestColumn {
  return { name, type, notNull, ...extra };
}

function mTable(name: string, module: string, columns: ManifestColumn[], primaryKey: string[] = ["id"]): ManifestTable {
  return { name, module, file: `data/${name}.ndjson`, rowCount: 0, primaryKey, columns };
}

function mManifest(tables: ManifestTable[], journalLastIdx = 0): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 3,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: { lastIdx: journalLastIdx, lastTag: "0000_test", entryCount: journalLastIdx + 1 } },
    redacted: false,
    includeBlobs: false,
    blobsMode: "none",
    modules: [...new Set(tables.map(t => t.module))].map(name => ({ name, deps: [] })),
    tables,
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
  };
}

/** Old-schema `users` def MISSING the live NOT NULL no-default `email`. */
function legacyUsersDef(name = "users"): ManifestTable {
  return mTable(name, "users", [
    col("id"),
    col("oauthSub"),
    col("username"),
    col("name"),
  ]);
}

function legacyUserRow(id: string): Record<string, unknown> {
  return { id, oauthSub: `sub-${id}`, username: `user-${id}`, name: `User ${id}` };
}

/** A contribution carrying only hooks — registered on top of the real ones. */
function registerHooks(hooks: Partial<BackupContribution> & { name: string }): void {
  registerBackupContribution({ tables: [], deps: [], ...hooks });
}

const emailFallback = {
  users: { email: (row: Record<string, unknown>) => `${row.username}@imported.local` },
};

describe("registry hook collection", () => {
  test("merges importFallbacks by table and keys importTransforms by fromTable", () => {
    registerHooks({ name: "hooks-a", importFallbacks: emailFallback });
    registerHooks({
      name: "hooks-b",
      importFallbacks: { users: { isVirtual: false } },
      importTransforms: [{ fromTable: "legacy_users", appliesTo: () => true, apply: row => [{ table: "users", row }] }],
    });

    const fallbacks = getImportFallbacksByTable();
    expect(Object.keys(fallbacks.get("users")!).sort()).toEqual(["email", "isVirtual"]);
    const transforms = getImportTransformsByTable();
    expect(transforms.get("legacy_users")).toHaveLength(1);
    expect(transforms.has("users")).toBe(false);
  });
});

describe("rule 4: importFallbacks fill NEW NOT-NULL columns", () => {
  test("fallback satisfies the otherwise-unsatisfiable column, counted defaulted and flagged fallback", () => {
    registerHooks({ name: "users-hooks", importFallbacks: emailFallback });

    const report = runImportDryRun(db, mManifest([legacyUsersDef()]), new Map([
      ["users", [legacyUserRow("u1aaaaaa"), legacyUserRow("u2aaaaaa")]],
    ]));

    const table = report.tables.users!;
    expect(table.error).toBeUndefined();
    expect(table.inserted).toBe(2);
    expect(table.defaultedColumns.email).toBe(2);
    expect(table.fallbackColumns).toEqual(["email"]);
    expect(report.totals.failed).toBe(0);
  });

  test("without a fallback the table still fails wholesale (rule 5)", () => {
    const report = runImportDryRun(db, mManifest([legacyUsersDef()]), new Map([
      ["users", [legacyUserRow("u1aaaaaa")]],
    ]));
    expect(report.tables.users!.error).toBe("missing-required-column: email");
    expect(report.totals.failed).toBe(1);
  });
});

describe("rule 8: vanished table re-homed by a transform", () => {
  const legacySettingsDef = mTable("legacy_settings", "settings", [col("key"), col("value")], ["key"]);

  function registerLegacySettingsTransform(maxJournalIdx = 5): void {
    registerHooks({
      name: "settings-hooks",
      importTransforms: [{
        fromTable: "legacy_settings",
        appliesTo: manifest => manifest.schema.journal.lastIdx < maxJournalIdx,
        apply: row => [{
          table: "settings",
          row: { key: row.key, value: row.value, updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" },
        }],
      }],
    });
  }

  test("rows flow into the new home, counted transformed; table not skipped", () => {
    registerLegacySettingsTransform();
    const report = runImportDryRun(db, mManifest([legacySettingsDef]), new Map([
      ["legacy_settings", [{ key: "k1", value: "v1" }, { key: "k2", value: "v2" }]],
    ]));

    expect(report.skippedTables).toEqual([]);
    expect(report.tables.legacy_settings).toBeUndefined();
    const settings = report.tables.settings!;
    expect(settings.transformed).toBe(2);
    expect(settings.inserted).toBe(2);
    expect(report.totals.transformed).toBe(2);
  });

  test("appliesTo gating: transform skipped for new-enough archives -> rule 7 applies", () => {
    registerLegacySettingsTransform(5);
    const report = runImportDryRun(db, mManifest([legacySettingsDef], 9), new Map([
      ["legacy_settings", [{ key: "k1", value: "v1" }]],
    ]));

    expect(report.skippedTables).toEqual(["legacy_settings"]);
    expect(report.tables.settings).toBeUndefined();
    expect(report.totals).toEqual({ inserted: 0, skippedDuplicate: 0, failed: 0, transformed: 0 });
  });

  test("transform output targeting an unknown table is dropped with a warning", () => {
    registerHooks({
      name: "bad-hooks",
      importTransforms: [{
        fromTable: "legacy_settings",
        appliesTo: () => true,
        apply: row => [{ table: "nonexistent", row }],
      }],
    });
    const report = runImportDryRun(db, mManifest([legacySettingsDef]), new Map([
      ["legacy_settings", [{ key: "k1", value: "v1" }]],
    ]));
    expect(report.warnings).toContain("transform-output-unknown-table: nonexistent (1 row(s) dropped)");
    expect(report.totals.inserted).toBe(0);
  });
});

describe("rename + NOT NULL combination (transform first, then fallback)", () => {
  test("re-homed rows missing a NEW NOT-NULL column are filled from importFallbacks", () => {
    registerHooks({
      name: "users-hooks",
      importFallbacks: emailFallback,
      importTransforms: [{
        fromTable: "legacy_users",
        appliesTo: manifest => manifest.schema.journal.lastIdx < 5,
        apply: row => [{ table: "users", row }],
      }],
    });

    const report = runImportDryRun(db, mManifest([legacyUsersDef("legacy_users")]), new Map([
      ["legacy_users", [legacyUserRow("u1aaaaaa")]],
    ]));

    expect(report.skippedTables).toEqual([]);
    const users = report.tables.users!;
    expect(users.transformed).toBe(1);
    expect(users.inserted).toBe(1);
    expect(users.defaultedColumns.email).toBe(1);
    expect(users.fallbackColumns).toEqual(["email"]);
    expect(users.failed.total).toBe(0);
  });
});

describe("dry-run == apply parity with hooks active", () => {
  test("reports are identical (modulo dryRun flag) and apply commits the transformed rows", async () => {
    registerHooks({
      name: "users-hooks",
      importFallbacks: emailFallback,
      importTransforms: [{
        fromTable: "legacy_users",
        appliesTo: () => true,
        apply: row => [{ table: "users", row }],
      }],
    });
    const manifest = mManifest([legacyUsersDef("legacy_users")]);
    const tables = new Map([["legacy_users", [legacyUserRow("u1aaaaaa"), legacyUserRow("u2aaaaaa")]]]);

    const dryRun = runImportDryRun(db, manifest, tables);
    const usersBefore = await db.all<{ id: string }>(sql`SELECT id FROM users`);
    expect(usersBefore).toHaveLength(0); // dry-run left no trace

    const applied = runImportMerge(db, manifest, tables);
    expect({ ...dryRun, dryRun: undefined }).toEqual({ ...applied, dryRun: undefined });

    const usersAfter = await db.all<{ id: string; email: string }>(sql`SELECT id, email FROM users ORDER BY id`);
    expect(usersAfter).toEqual([
      { id: "u1aaaaaa", email: "user-u1aaaaaa@imported.local" },
      { id: "u2aaaaaa", email: "user-u2aaaaaa@imported.local" },
    ]);
  });
});
