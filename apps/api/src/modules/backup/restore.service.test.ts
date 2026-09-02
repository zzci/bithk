import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import { assertIdShape, reconcileRestoredFiles } from "./restore.service";

// The restore service relies on the global backup registry. Each test
// resets and re-registers exactly the contributions it needs so cases
// cannot leak state across the file.
let db: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "restore-service-"));
  db = await createDb(resolve(dir, "app.db"));
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  __resetBackupRegistryForTests();
});

describe("reconcileRestoredFiles — blobs are out of backup scope", () => {
  const present = "a".repeat(64);
  const missing = "b".repeat(64);
  const presentKey = `${present.slice(0, 2)}/${present.slice(2, 4)}/${present}`;
  const missingKey = `${missing.slice(0, 2)}/${missing.slice(2, 4)}/${missing}`;

  beforeEach(async () => {
    registerBackupContribution(fileBackupContribution);
    __resetDriverRegistryForTests();
    const { getActiveDriver } = await import("@/modules/file/storage/registry");
    __setLocalDriverRootForTests(resolve(dir, "blobs"));
    setActiveDriver("local");
    // The "present" blob is physically on disk; the "missing" one is not —
    // simulating a backup restored onto a backend that lacks the bytes.
    await getActiveDriver().put(presentKey, new TextEncoder().encode("real-bytes").buffer);
  });

  afterEach(() => {
    __resetDriverRegistryForTests();
  });

  test("reconcile quarantines files rows whose backing blob is absent, keeps ones present", async () => {
    await db.run(sql`INSERT INTO users (id, oauth_sub, username, name, email, role, status, created_at, updated_at) VALUES ('u_f', 'sub_f', 'fuser', 'F', 'f@example.com', 'admin', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
    // Two restored-looking rows on the active driver: one whose blob exists,
    // one whose bytes never arrived (a backup restored onto a bare backend).
    await db.run(sql`INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('file_present', ${present}, 10, 'text/plain', 'local', ${presentKey}, 1, 'u_f'),
             ('file_missing', ${missing}, 10, 'text/plain', 'local', ${missingKey}, 1, 'u_f')`);

    const result = await reconcileRestoredFiles(db);
    expect(result).toEqual({ checked: 2, quarantined: 1 });

    const present_ = await db.all<{ id: string; storage_driver: string; ref_count: number }>(
      sql`SELECT id, storage_driver, ref_count FROM files WHERE id = 'file_present'`,
    );
    expect(present_[0]?.storage_driver).toBe("local");
    expect(present_[0]?.ref_count).toBe(1);

    const missing_ = await db.all<{ id: string; storage_driver: string; ref_count: number }>(
      sql`SELECT id, storage_driver, ref_count FROM files WHERE id = 'file_missing'`,
    );
    // Quarantined: row kept (not hard-deleted) but driver flipped to the
    // sentinel + ref_count zeroed so downloads 404 cleanly and the GC skips it.
    expect(missing_).toHaveLength(1);
    expect(missing_[0]?.storage_driver).not.toBe("local");
    expect(missing_[0]?.storage_driver).toContain("quarantined");
    expect(missing_[0]?.ref_count).toBe(0);
  });

  test("reconcileRestoredFiles is a safe no-op when there are no files rows", async () => {
    const r = await reconcileRestoredFiles(db);
    expect(r).toEqual({ checked: 0, quarantined: 0 });
  });
});

describe("assertIdShape", () => {
  test("accepts the safe id alphabet on id-like fields", () => {
    expect(() => assertIdShape({ id: "k8ezp0tp", parentEntryId: "ujvbg8ex", owner_id: "seed-user-1" })).not.toThrow();
  });

  test("treats an empty-string id field as a no-reference sentinel (FIX-041)", () => {
    // `drive_entries` root rows carry `parent_entry_id = ""`; a backup of them
    // must import rather than be rejected as a bad id format.
    expect(() => assertIdShape({ id: "9zo46dcg", parentEntryId: "" })).not.toThrow();
  });

  test("rejects an unsafe id format on an id-like field", () => {
    expect(() => assertIdShape({ parentEntryId: "../etc/passwd" })).toThrow(/Invalid id format on field parentEntryId/);
  });

  test("ignores non-id fields and non-string values", () => {
    expect(() => assertIdShape({ name: "a/b c", favorite: 0, id: null })).not.toThrow();
  });
});
