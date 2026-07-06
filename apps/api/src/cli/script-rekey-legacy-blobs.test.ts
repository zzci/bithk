import type { AppDatabase } from "@/db";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb } from "@/db";
import { legacyContentAddressedKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { ulid, ulidTimeMs } from "@/shared/lib/id";
import { seedUser, stubLogger, testConfig } from "@/shared/test/route-harness";
import { runRekeyLegacyBlobs } from "./script-rekey-legacy-blobs";

let db: AppDatabase;
let baseDir: string;

beforeEach(async () => {
  baseDir = mkdtempSync(resolve(tmpdir(), "rekey-test-"));
  db = await createDb(resolve(baseDir, "test.db"));
  __resetDriverRegistryForTests();
  registerDriver(localDriver);
  __setLocalDriverRootForTests(resolve(baseDir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  rmSync(baseDir, { recursive: true, force: true });
});

function sha256Of(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

/** Insert a files row + (optionally) its blob on the legacy content-addressed key. */
async function seedLegacyBlob(
  userId: string,
  content: string,
  opts: { driver?: string; withBytes?: boolean } = {},
): Promise<{ id: string; sha: string; legacyKey: string }> {
  const bytes = new TextEncoder().encode(content);
  const sha = sha256Of(bytes);
  const id = ulid();
  const legacyKey = legacyContentAddressedKey(sha);
  await db.run(sql`
    INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
    VALUES (${id}, ${sha}, ${bytes.length}, 'text/plain', ${opts.driver ?? "local"}, ${legacyKey}, 1, ${userId})
  `);
  if (opts.withBytes !== false)
    await localDriver.put(legacyKey, bytes.buffer as ArrayBuffer);
  return { id, sha, legacyKey };
}

async function keyOf(id: string): Promise<string> {
  const rows = await db.all<{ storage_key: string }>(sql`SELECT storage_key FROM files WHERE id = ${id}`);
  return rows[0]!.storage_key;
}

function ctx(dryRun = false) {
  return { db, config: testConfig({ DATA_DIR: baseDir }), logger: stubLogger, dryRun };
}

describe("rekey-legacy-blobs (CHORE-004)", () => {
  test("moves a legacy blob to YYYYMMDDHH/<ulid> (hour = the row id's mint hour) and deletes the old object", async () => {
    const u1 = await seedUser(db, "user");
    const { id, legacyKey } = await seedLegacyBlob(u1, "legacy bytes");

    expect(await runRekeyLegacyBlobs(ctx())).toBe(0);

    const newKey = await keyOf(id);
    expect(newKey).toMatch(/^\d{10}\/[0-9a-hjkmnp-tv-z]{26}$/);
    const d = new Date(ulidTimeMs(id)!);
    const pad = (n: number): string => String(n).padStart(2, "0");
    expect(newKey).toBe(`${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}/${id}`);

    // Bytes moved: readable at the new key, gone from the legacy path.
    expect(await localDriver.exists(newKey)).toBe(true);
    expect(await localDriver.exists(legacyKey)).toBe(false);
    const text = await new Response(await localDriver.getStream(newKey)).text();
    expect(text).toBe("legacy bytes");
  });

  test("is idempotent: a second run skips already-migrated rows", async () => {
    const u1 = await seedUser(db, "user");
    await seedLegacyBlob(u1, "one");
    await runRekeyLegacyBlobs(ctx());
    // Re-run: nothing legacy-shaped remains; nothing fails.
    expect(await runRekeyLegacyBlobs(ctx())).toBe(0);
  });

  test("dry-run reports without touching rows or objects", async () => {
    const u1 = await seedUser(db, "user");
    const { id, legacyKey } = await seedLegacyBlob(u1, "untouched");

    expect(await runRekeyLegacyBlobs(ctx(true))).toBe(0);

    expect(await keyOf(id)).toBe(legacyKey);
    expect(await localDriver.exists(legacyKey)).toBe(true);
  });

  test("skips quarantined rows and non-legacy keys", async () => {
    const u1 = await seedUser(db, "user");
    const bytes = new TextEncoder().encode("q");
    const qSha = sha256Of(bytes);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('fq', ${qSha}, 1, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(qSha)}, 0, ${u1})
    `);
    const modernId = ulid();
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES (${modernId}, ${"a".repeat(64)}, 1, 'text/plain', 'local', ${`2026070609/${modernId}`}, 1, ${u1})
    `);

    expect(await runRekeyLegacyBlobs(ctx())).toBe(0);
    expect(await keyOf("fq")).toBe(legacyContentAddressedKey(qSha));
    expect(await keyOf(modernId)).toBe(`2026070609/${modernId}`);
  });

  test("a row whose blob is missing counts as failed, stays on its legacy key, and exits 1", async () => {
    const u1 = await seedUser(db, "user");
    const { id, legacyKey } = await seedLegacyBlob(u1, "gone", { withBytes: false });

    expect(await runRekeyLegacyBlobs(ctx())).toBe(1);
    expect(await keyOf(id)).toBe(legacyKey);
    expect(existsSync(resolve(baseDir, "blobs", legacyKey))).toBe(false);
  });
});
