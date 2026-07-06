import type { Headers } from "tar-stream";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { pack as tarPack } from "tar-stream";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { fileBackupContribution } from "@/modules/file/file.backup";
import { legacyContentAddressedKey } from "@/modules/file/storage/key";
import { __setLocalDriverRootForTests, localDriver } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, registerDriver, setActiveDriver } from "@/modules/file/storage/registry";
import { AppError } from "@/shared/lib/errors";
import { seedUser, stubLogger, testConfig, testNanoid } from "@/shared/test/route-harness";
import { restoreBlobArchive, unquarantineRestoredFiles } from "./blob-restore";
import { getBackupStagingRoot } from "./export-job.service";
import { prepareImport } from "./import.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-blob-restore-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir });
  __resetBackupRegistryForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(fileBackupContribution);
  registerDriver(localDriver);
  __setLocalDriverRootForTests(resolve(baseDir, "blob-root"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetDriverRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

// ─── Fixtures ────────────────────────────────────────────────────────────

interface TestEntry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  readonly type?: Headers["type"];
  readonly linkname?: string;
}

async function blobArchive(entries: TestEntry[]): Promise<File> {
  const pack = tarPack();
  const drained = (async () => {
    const out: Buffer[] = [];
    for await (const chunk of pack as AsyncIterable<Buffer>)
      out.push(chunk);
    return Buffer.concat(out);
  })();
  for (const entry of entries) {
    if (entry.type && entry.type !== "file")
      pack.entry({ name: entry.name, type: entry.type, linkname: entry.linkname, size: 0 }, "");
    else
      pack.entry({ name: entry.name }, Buffer.from(entry.data ?? ""));
  }
  pack.finalize();
  return new File([Bun.gzipSync(await drained)], "blobs.tar.gz", { type: "application/gzip" });
}

function sha256Of(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

function blobEntry(data: Uint8Array, shaOverride?: string): TestEntry {
  return { name: `blobs/${legacyContentAddressedKey(shaOverride ?? sha256Of(data))}`, data };
}

async function expectReject(file: File, code: string, messageHint?: string): Promise<void> {
  try {
    await restoreBlobArchive(db, config, file, {}, stubLogger);
    throw new Error("expected restoreBlobArchive to reject");
  }
  catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    if (messageHint)
      expect((err as AppError).message).toContain(messageHint);
  }
}

// ─── Happy path & idempotence ────────────────────────────────────────────

describe("restoreBlobArchive — happy path", () => {
  test("writes verified blobs; re-upload is all skippedExisting (idempotent)", async () => {
    const u1 = await seedUser(db, "user");
    const b1 = new TextEncoder().encode("blob one");
    const b2 = new TextEncoder().encode("blob two");
    // REFACTOR-038: blobs land at their files row's stored key — rowless
    // entries are skipped, so name the targets via quarantined rows.
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES
        ('fb1', ${sha256Of(b1)}, ${b1.length}, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(sha256Of(b1))}, 0, ${u1}),
        ('fb2', ${sha256Of(b2)}, ${b2.length}, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(sha256Of(b2))}, 0, ${u1})
    `);
    const file = await blobArchive([blobEntry(b1), blobEntry(b2)]);

    const report = await restoreBlobArchive(db, config, file, {}, stubLogger);
    expect(report.written).toBe(2);
    expect(report.skippedExisting).toBe(0);
    expect(report.failed).toBe(0);
    expect(await localDriver.exists(legacyContentAddressedKey(sha256Of(b1)))).toBe(true);
    expect(await localDriver.exists(legacyContentAddressedKey(sha256Of(b2)))).toBe(true);

    const again = await restoreBlobArchive(db, config, file, {}, stubLogger);
    expect(again.written).toBe(0);
    expect(again.skippedExisting).toBe(2);
    expect(again.failed).toBe(0);
  });

  test("an entry no files row references is skipped as unreferenced", async () => {
    const orphan = new TextEncoder().encode("nobody references me");
    const report = await restoreBlobArchive(db, config, await blobArchive([blobEntry(orphan)]), {}, stubLogger);
    expect(report.written).toBe(0);
    expect(report.unreferenced).toBe(1);
    expect(await localDriver.exists(legacyContentAddressedKey(sha256Of(orphan)))).toBe(false);
  });

  test("a hash-mismatching entry counts failed and is never written", async () => {
    const u1 = await seedUser(db, "user");
    const good = new TextEncoder().encode("good bytes");
    const liarSha = sha256Of(new TextEncoder().encode("other bytes"));
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('fl1', ${liarSha}, ${good.length}, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(liarSha)}, 0, ${u1})
    `);
    const file = await blobArchive([blobEntry(good, liarSha)]);

    const report = await restoreBlobArchive(db, config, file, {}, stubLogger);
    expect(report.written).toBe(0);
    expect(report.failed).toBe(1);
    expect(await localDriver.exists(legacyContentAddressedKey(liarSha))).toBe(false);
  });

  test("un-quarantines files rows whose bytes arrived, then reconciles clean", async () => {
    const u1 = await seedUser(db, "user");
    const bytes = new TextEncoder().encode("late-arriving blob");
    const sha = sha256Of(bytes);
    // A row quarantined by a prior reconcile (sentinel driver, ref_count 0).
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, ${bytes.length}, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(sha)}, 0, ${u1})
    `);

    const report = await restoreBlobArchive(db, config, await blobArchive([blobEntry(bytes)]), {}, stubLogger);
    expect(report.written).toBe(1);
    expect(report.unquarantined).toBe(1);
    expect(report.reconcile).toEqual({ checked: 1, quarantined: 0 });
    const row = await db.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
    expect(row[0]!.storage_driver).toBe("local");
  });

  test("unquarantineRestoredFiles leaves rows whose blob is still absent", async () => {
    const u1 = await seedUser(db, "user");
    const sha = "ab".repeat(32);
    await db.run(sql`
      INSERT INTO files (id, sha256, size, mimetype, storage_driver, storage_key, ref_count, uploaded_by)
      VALUES ('f1', ${sha}, 4, 'text/plain', 'quarantined:backup-restore-missing-blob', ${legacyContentAddressedKey(sha)}, 0, ${u1})
    `);
    expect(await unquarantineRestoredFiles(db, stubLogger)).toBe(0);
    const row = await db.all<{ storage_driver: string }>(sql`SELECT storage_driver FROM files WHERE id = 'f1'`);
    expect(row[0]!.storage_driver).toBe("quarantined:backup-restore-missing-blob");
  });

  test("staging is cleaned up after success and after rejection", async () => {
    await restoreBlobArchive(db, config, await blobArchive([blobEntry(new Uint8Array(8).fill(3))]), {}, stubLogger);
    await expectReject(await blobArchive([{ name: "evil.txt", data: "x" }]), "MALFORMED_ARCHIVE");
    const root = resolve(getBackupStagingRoot(config), "blob-restores");
    expect(!existsSync(root) || readdirSync(root).length === 0).toBe(true);
  });
});

// ─── Validation: allowlist, traversal corpus, cross-endpoint ─────────────

describe("restoreBlobArchive — blobs-only allowlist", () => {
  test("rejects a DATA archive with a cross-endpoint hint (manifest.json)", async () => {
    const file = await blobArchive([
      { name: "manifest.json", data: "{}" },
      { name: "data/settings.ndjson", data: "" },
    ]);
    await expectReject(file, "MALFORMED_ARCHIVE", "/api/backup/v2/imports");
  });

  test("rejects data/ entries with the same hint", async () => {
    await expectReject(
      await blobArchive([{ name: "data/settings.ndjson", data: "" }]),
      "MALFORMED_ARCHIVE",
      "/api/backup/v2/imports",
    );
  });

  test("a blobs-only archive uploaded to the DATA import endpoint is rejected with the reverse hint", async () => {
    const file = await blobArchive([blobEntry(new Uint8Array(4).fill(9))]);
    try {
      await prepareImport(db, config, file);
      throw new Error("expected prepareImport to reject");
    }
    catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("MALFORMED_ARCHIVE");
      expect((err as AppError).message).toContain("/api/backup/v2/blob-restores");
    }
  });

  test("rejects an empty archive (no blob entries)", async () => {
    await expectReject(await blobArchive([]), "MALFORMED_ARCHIVE");
  });

  test("rejects bytes that are not a gzipped tar", async () => {
    await expectReject(new File([new Uint8Array(64).fill(7)], "x.tar.gz"), "MALFORMED_ARCHIVE");
  });

  const sha = "ab".repeat(32);
  const corpus: { label: string; entry: TestEntry }[] = [
    { label: "absolute path", entry: { name: "/etc/passwd", data: "x" } },
    { label: "dot-dot traversal", entry: { name: "blobs/../../evil", data: "x" } },
    { label: "non-allowlist path", entry: { name: "extra.txt", data: "x" } },
    { label: "blob path with wrong prefix bytes", entry: { name: `blobs/ff/00/${sha}`, data: "x" } },
    { label: "blob path with short hash", entry: { name: "blobs/ab/ab/abab", data: "x" } },
    { label: "symlink entry", entry: { name: `blobs/ab/ab/${sha}`, type: "symlink", linkname: "/etc/passwd" } },
    { label: "hardlink entry", entry: { name: `blobs/ab/ab/${sha}`, type: "link", linkname: "/etc/passwd" } },
    { label: "directory entry", entry: { name: "blobs/", type: "directory" } },
  ];
  for (const { label, entry } of corpus) {
    test(`rejects ${label}`, async () => {
      await expectReject(await blobArchive([entry]), "MALFORMED_ARCHIVE");
    });
  }

  test("rejects duplicate blob entries", async () => {
    const bytes = new Uint8Array(4).fill(1);
    await expectReject(await blobArchive([blobEntry(bytes), blobEntry(bytes)]), "MALFORMED_ARCHIVE");
  });

  test("rejects the WHOLE archive before writing anything (two-pass)", async () => {
    const good = new TextEncoder().encode("good blob");
    const file = await blobArchive([
      blobEntry(good),
      { name: "evil.txt", data: "x" },
    ]);
    await expectReject(file, "MALFORMED_ARCHIVE");
    // The valid leading entry was NOT imported — validation precedes writes.
    expect(await localDriver.exists(legacyContentAddressedKey(sha256Of(good)))).toBe(false);
  });
});

// ─── Caps ────────────────────────────────────────────────────────────────

describe("restoreBlobArchive — caps", () => {
  test("compressed upload above the archive cap is rejected (counted bytes)", async () => {
    const file = await blobArchive([blobEntry(new Uint8Array(512).fill(1))]);
    await expect(restoreBlobArchive(db, config, file, { maxArchiveBytes: 16 }))
      .rejects
      .toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("a blob entry above the per-blob cap is rejected", async () => {
    const file = await blobArchive([blobEntry(new Uint8Array(4096).fill(1))]);
    await expect(restoreBlobArchive(db, config, file, { maxBlobBytes: 1024 }))
      .rejects
      .toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("the tar entry-count cap rejects entry floods", async () => {
    const file = await blobArchive([
      blobEntry(new Uint8Array(4).fill(1)),
      blobEntry(new Uint8Array(4).fill(2)),
    ]);
    await expect(restoreBlobArchive(db, config, file, { maxEntries: 1 }))
      .rejects
      .toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("total decompressed bytes above the cap are rejected", async () => {
    // Highly compressible: tiny on the wire, large decompressed.
    const file = await blobArchive([blobEntry(new Uint8Array(256 * 1024))]);
    await expect(restoreBlobArchive(db, config, file, { maxDecompressedBytes: 64 * 1024 }))
      .rejects
      .toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("rejects when no storage driver is active", async () => {
    __resetDriverRegistryForTests();
    const file = await blobArchive([blobEntry(new Uint8Array(4).fill(1))]);
    await expect(restoreBlobArchive(db, config, file)).rejects.toMatchObject({ code: "NO_STORAGE_DRIVER" });
  });
});
