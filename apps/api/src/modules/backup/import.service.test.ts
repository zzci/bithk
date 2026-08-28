import type { Headers } from "tar-stream";
import type { BackupManifestV2, ManifestColumn, ManifestTable } from "./archive.service";
import type { ImportJob } from "./import.service";
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
import { settingsBackupContribution } from "@/modules/settings/settings.backup";
import { AppError } from "@/shared/lib/errors";
import { testConfig, testNanoid } from "@/shared/test/route-harness";
import { BACKUP_FORMAT_VERSION, writeArchiveV2 } from "./archive.service";
import { getBackupStagingRoot } from "./export-job.service";
import {
  __resetImportJobsForTests,
  discardImportJob,
  getImportJob,
  prepareImport,
  registerImportJob,
} from "./import.service";
import { __resetBackupRegistryForTests, registerBackupContribution } from "./registry";
import "@/modules/account";

let db: AppDatabase;
let baseDir: string;
let config: Config;

beforeEach(async () => {
  baseDir = resolve(tmpdir(), `test-backup-import-${Date.now()}-${testNanoid()}`);
  mkdirSync(baseDir, { recursive: true });
  db = await createDb(resolve(baseDir, "test.db"));
  config = testConfig({ DATA_DIR: baseDir });
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(settingsBackupContribution);
  registerBackupContribution(fileBackupContribution);
});

afterEach(() => {
  db.close();
  __resetBackupRegistryForTests();
  __resetImportJobsForTests();
  __resetDriverRegistryForTests();
  if (existsSync(baseDir))
    rmSync(baseDir, { recursive: true, force: true });
});

// ─── Archive fixtures ────────────────────────────────────────────────────

interface TestEntry {
  readonly name: string;
  readonly data?: string | Uint8Array;
  readonly type?: Headers["type"];
  readonly linkname?: string;
}

/** Pack + gzip a synthetic archive (small fixtures buffer fine in memory). */
async function archiveFile(entries: TestEntry[]): Promise<File> {
  const pack = tarPack();
  const drained = (async () => {
    const out: Buffer[] = [];
    for await (const chunk of pack as AsyncIterable<Buffer>)
      out.push(chunk);
    return Buffer.concat(out);
  })();
  for (const entry of entries) {
    if (entry.type && entry.type !== "file") {
      pack.entry({ name: entry.name, type: entry.type, linkname: entry.linkname, size: 0 }, "");
    }
    else {
      pack.entry({ name: entry.name }, Buffer.from(entry.data ?? ""));
    }
  }
  pack.finalize();
  const tar = await drained;
  return new File([Bun.gzipSync(tar)], "backup.tar.gz", { type: "application/gzip" });
}

function col(name: string, type = "text", notNull = true, extra: Partial<ManifestColumn> = {}): ManifestColumn {
  return { name, type, notNull, ...extra };
}

function settingsTableDef(): ManifestTable {
  return {
    name: "settings",
    module: "settings",
    file: "data/settings.ndjson",
    rowCount: 1,
    primaryKey: ["key"],
    columns: [col("key"), col("value"), col("updatedBy", "text", false), col("updatedAt")],
  };
}

function baseManifest(overrides: Partial<BackupManifestV2> = {}): BackupManifestV2 {
  return {
    format: "bithk-backup",
    formatVersion: 3,
    exportedAt: "2026-06-10T00:00:00.000Z",
    app: { name: "app", version: "0.0.0", commit: "0000000" },
    schema: { dialect: "sqlite", journal: { lastIdx: 0, lastTag: "0000_test", entryCount: 1 } },
    redacted: false,
    includeBlobs: false,
    blobsMode: "none",
    modules: [{ name: "settings", deps: [] }],
    tables: [settingsTableDef()],
    blobs: { count: 0, totalBytes: 0 },
    warnings: [],
    ...overrides,
  };
}

const SETTINGS_ROW = `${JSON.stringify({ key: "k1", value: "v1", updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" })}\n`;

function validEntries(manifest: BackupManifestV2 = baseManifest()): TestEntry[] {
  return [
    { name: "manifest.json", data: JSON.stringify(manifest) },
    { name: "data/settings.ndjson", data: SETTINGS_ROW },
  ];
}

async function expectReject(file: File, code: string): Promise<AppError> {
  try {
    await prepareImport(db, config, file);
    throw new Error("expected prepareImport to reject");
  }
  catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return err as AppError;
  }
}

describe("prepareImport — happy path", () => {
  test("stages, validates, dry-runs and returns a validated job", async () => {
    const job = await prepareImport(db, config, await archiveFile(validEntries()));
    expect(job.state).toBe("validated");
    expect(job.report.totals.inserted).toBe(1);
    expect(job.report.dryRun).toBe(true);
    expect(existsSync(job.archivePath)).toBe(true);
    expect(job.archivePath).toBe(resolve(getBackupStagingRoot(config), "imports", job.id, "archive.tar.gz"));
    expect([...job.tables.keys()]).toEqual(["settings"]);
    expect(job.tables.get("settings")).toHaveLength(1);
    // Dry-run wrote nothing to live data.
    const live = await db.all(sql`SELECT * FROM settings`);
    expect(live).toHaveLength(0);
  });

  test("round trip: a real writeArchiveV2 archive re-imports as pure duplicates", async () => {
    await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES ('k1', 'v', '2026-01-01T00:00:00Z')`);
    const { archivePath } = await writeArchiveV2({
      db,
      modules: ["settings"],
      stagingDir: resolve(baseDir, "export-staging"),
      appName: "app",
    });
    const job = await prepareImport(db, config, Bun.file(archivePath));
    expect(job.report.tables.settings!.skippedDuplicate).toBe(1);
    expect(job.report.totals.inserted).toBe(0);
    // The staged copy is intact and distinct from the export staging.
    expect(existsSync(job.archivePath)).toBe(true);
  });

  test("blob existence-check counts present and missing blobs without writing", async () => {
    registerDriver(localDriver);
    __setLocalDriverRootForTests(resolve(baseDir, "blob-root"));
    setActiveDriver("local");
    const present = "ab".repeat(32);
    const missing = "cd".repeat(32);
    await localDriver.put(legacyContentAddressedKey(present), new Uint8Array(16).fill(1).buffer as ArrayBuffer);

    const manifest = baseManifest({ includeBlobs: true, blobs: { count: 2, totalBytes: 32 } });
    const job = await prepareImport(db, config, await archiveFile([
      ...validEntries(manifest),
      { name: `blobs/${legacyContentAddressedKey(present)}`, data: new Uint8Array(16).fill(1) },
      { name: `blobs/${legacyContentAddressedKey(missing)}`, data: new Uint8Array(16).fill(2) },
    ]));
    expect(job.report.blobs).toEqual({ count: 2, existing: 1, missing: 1 });
    // NEVER written: the missing blob is still absent on the driver.
    expect(await localDriver.exists(legacyContentAddressedKey(missing))).toBe(false);
  });
});

describe("import job lifecycle", () => {
  test("register / get / discard removes staging; unknown ids return false", async () => {
    const job = await prepareImport(db, config, await archiveFile(validEntries()));
    registerImportJob(job);
    expect(getImportJob(job.id)).toBe(job);

    expect(discardImportJob(job.id)).toBe(true);
    expect(getImportJob(job.id)).toBeUndefined();
    expect(existsSync(job.stagingDir)).toBe(false);

    expect(discardImportJob("nope")).toBe(false);
  });

  test("discard refuses while an apply is running (Phase 3 state)", async () => {
    const job = await prepareImport(db, config, await archiveFile(validEntries()));
    registerImportJob(job);
    (job as ImportJob).state = "applying";
    expect(() => discardImportJob(job.id)).toThrow("cannot be discarded");
    expect(existsSync(job.stagingDir)).toBe(true);
  });

  test("a failed upload leaves no staging debris", async () => {
    await expectReject(await archiveFile([{ name: "evil.txt", data: "x" }]), "MALFORMED_ARCHIVE");
    const importsRoot = resolve(getBackupStagingRoot(config), "imports");
    expect(!existsSync(importsRoot) || readdirSync(importsRoot).length === 0).toBe(true);
  });
});

describe("format & manifest gates", () => {
  test("manifest.json must be the first entry", async () => {
    const [manifest, data] = validEntries();
    await expectReject(await archiveFile([data!, manifest!]), "MALFORMED_ARCHIVE");
  });

  test("unknown format string is rejected", async () => {
    await expectReject(
      await archiveFile(validEntries(baseManifest({ format: "evil-backup" as BackupManifestV2["format"] }))),
      "INVALID_FORMAT",
    );
  });

  test("a NEWER formatVersion is rejected as UNSUPPORTED_VERSION", async () => {
    await expectReject(
      await archiveFile(validEntries(baseManifest({ formatVersion: 4 as BackupManifestV2["formatVersion"] }))),
      "UNSUPPORTED_VERSION",
    );
  });

  test("the current formatVersion still imports", async () => {
    expect(BACKUP_FORMAT_VERSION).toBe(3);
    const job = await prepareImport(db, config, await archiveFile(validEntries(baseManifest({ formatVersion: 3 }))));
    expect(job.state).toBe("validated");
    expect(job.manifest.formatVersion).toBe(3);
    discardImportJob(job.id);
  });

  // PLAN-108: format 2 is the last pre-reset epoch. The message has to name the
  // reset and the operator's only remaining option — assert the wording so it
  // cannot silently decay back into a bare version number.
  test("a pre-reset formatVersion 2 archive is refused with an actionable message", async () => {
    const err = await expectReject(
      await archiveFile(validEntries(baseManifest({ formatVersion: 2 as BackupManifestV2["formatVersion"] }))),
      "INVALID_FORMAT",
    );
    expect(err.message).toContain("Backup format version 2 predates the projects-as-sections schema reset (format 3)");
    expect(err.message).toContain("cannot be imported or migrated");
    expect(err.message).toContain("run a pre-reset build of the server against a copy");
  });

  test("an unknown OLDER formatVersion is rejected as INVALID_FORMAT", async () => {
    await expectReject(
      await archiveFile(validEntries(baseManifest({ formatVersion: 1 as BackupManifestV2["formatVersion"] }))),
      "INVALID_FORMAT",
    );
  });

  test("empty module list is rejected (mirrors v1 NO_MODULES)", async () => {
    await expectReject(
      await archiveFile([
        { name: "manifest.json", data: JSON.stringify(baseManifest({ modules: [], tables: [] })) },
      ]),
      "NO_MODULES",
    );
  });

  test("a data entry not declared in the manifest is rejected", async () => {
    await expectReject(
      await archiveFile([...validEntries(), { name: "data/ghosts.ndjson", data: "" }]),
      "MALFORMED_ARCHIVE",
    );
  });

  test("a manifest table whose data entry is missing is rejected", async () => {
    await expectReject(
      await archiveFile([{ name: "manifest.json", data: JSON.stringify(baseManifest()) }]),
      "MALFORMED_ARCHIVE",
    );
  });

  test("bytes that are not a gzipped tar are rejected", async () => {
    const file = new File([new Uint8Array(64).fill(7)], "backup.tar.gz");
    await expectReject(file, "MALFORMED_ARCHIVE");
  });
});

describe("path-traversal corpus (zip-slip allowlist)", () => {
  const cases: { label: string; entry: TestEntry }[] = [
    { label: "absolute path", entry: { name: "/etc/passwd", data: "x" } },
    { label: "dot-dot traversal", entry: { name: "data/../../evil.ndjson", data: "x" } },
    { label: "non-allowlist path", entry: { name: "extra.txt", data: "x" } },
    { label: "nested non-allowlist path", entry: { name: "data/sub/dir.ndjson", data: "x" } },
    { label: "blob path with wrong prefix bytes", entry: { name: `blobs/ff/00/${"ab".repeat(32)}`, data: "x" } },
    { label: "blob path with short hash", entry: { name: "blobs/ab/ab/abab", data: "x" } },
    { label: "symlink entry", entry: { name: "data/settings.ndjson", type: "symlink", linkname: "/etc/passwd" } },
    { label: "hardlink entry", entry: { name: "data/settings.ndjson", type: "link", linkname: "/etc/passwd" } },
    { label: "directory entry", entry: { name: "data/", type: "directory" } },
  ];

  for (const { label, entry } of cases) {
    test(`rejects ${label}`, async () => {
      await expectReject(await archiveFile([validEntries()[0]!, entry]), "MALFORMED_ARCHIVE");
    });
  }
});

describe("decompression-bomb caps", () => {
  test("compressed upload above the archive cap is rejected (counted bytes, not the header)", async () => {
    const file = await archiveFile(validEntries());
    await expect(prepareImport(db, config, file, { maxArchiveBytes: 16 })).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("total decompressed bytes above the cap are rejected", async () => {
    // Highly compressible payload: tiny on the wire, huge decompressed.
    const rows = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({ key: `k${i}`, value: "0".repeat(4096), updatedBy: null, updatedAt: "2026-01-01T00:00:00Z" })).join("\n");
    const file = await archiveFile([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: rows },
    ]);
    await expect(prepareImport(db, config, file, { maxDecompressedBytes: 64 * 1024 })).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("a blob entry above the per-blob cap is rejected", async () => {
    const sha = "ab".repeat(32);
    const manifest = baseManifest({ includeBlobs: true, blobs: { count: 1, totalBytes: 4096 } });
    const file = await archiveFile([
      ...validEntries(manifest),
      { name: `blobs/${legacyContentAddressedKey(sha)}`, data: new Uint8Array(4096) },
    ]);
    await expect(prepareImport(db, config, file, { maxBlobBytes: 1024 })).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("the tar entry-count cap rejects entry floods", async () => {
    const file = await archiveFile(validEntries());
    await expect(prepareImport(db, config, file, { maxEntries: 1 })).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  test("an NDJSON line above the per-row cap is rejected", async () => {
    const file = await archiveFile([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: `${JSON.stringify({ key: "k1", value: "x".repeat(2048), updatedBy: null, updatedAt: "t" })}\n` },
    ]);
    await expect(prepareImport(db, config, file, { maxLineBytes: 1024 })).rejects.toMatchObject({ code: "INVALID_BACKUP_ROW" });
  });

  test("per-table and total row caps are enforced (v1 constants, injectable)", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => JSON.stringify({ key: `k${i}`, value: "v", updatedBy: null, updatedAt: "t" })).join("\n");
    const file = await archiveFile([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: rows },
    ]);
    await expect(prepareImport(db, config, file, { maxRowsPerTable: 2 })).rejects.toMatchObject({ code: "INVALID_BACKUP_ROW" });
    await expect(prepareImport(db, config, file, { maxTotalRows: 2 })).rejects.toMatchObject({ code: "INVALID_BACKUP_ROW" });
  });
});

describe("row sanity (v1 helpers)", () => {
  test("id-like fields outside the URL-safe alphabet reject the archive", async () => {
    const manifest = baseManifest({
      modules: [{ name: "users", deps: [] }],
      tables: [{
        name: "users",
        module: "users",
        file: "data/users.ndjson",
        rowCount: 1,
        primaryKey: ["id"],
        columns: [col("id"), col("oauthSub"), col("username"), col("name"), col("email")],
      }],
    });
    const file = await archiveFile([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "data/users.ndjson", data: `${JSON.stringify({ id: "../../etc", oauthSub: "s", username: "u", name: "n", email: "e@t" })}\n` },
    ]);
    await expectReject(file, "INVALID_BACKUP_ROW");
  });

  test("non-object NDJSON rows reject the archive", async () => {
    const file = await archiveFile([
      { name: "manifest.json", data: JSON.stringify(baseManifest()) },
      { name: "data/settings.ndjson", data: "[1,2,3]\n" },
    ]);
    await expectReject(file, "MALFORMED_ARCHIVE");
  });
});
