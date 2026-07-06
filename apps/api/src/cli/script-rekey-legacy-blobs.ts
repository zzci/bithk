import type { CliCommand } from "./types";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { consola } from "consola";
import { eq } from "drizzle-orm";
import { QUARANTINED_DRIVER_PREFIX } from "@/modules/file/file.service";
import { files } from "@/modules/file/schema";
import { legacyContentAddressedKey, newStorageKey } from "@/modules/file/storage/key";
import { getDriver } from "@/modules/file/storage/registry";
import { ulidTimeMs } from "@/shared/lib/id";
import { withRuntime } from "./runtime";

// CHORE-004: one-shot migration of pre-v0.3.0 blobs from the retired
// content-addressed layout (`ab/cd/<sha256>`) to the hour-bucketed layout
// (`YYYYMMDDHH/<ulid>`). The target hour comes from the row id's ULID mint
// time, so the directory reflects when the blob was actually uploaded.
//
// Per row: copy the object to its new key, verify it landed, repoint
// `files.storage_key`, then delete the old object. Idempotent and resumable:
// a re-run skips already-migrated rows (their key is no longer legacy-shaped)
// and a failed row is left untouched on its old key, still fully served.

const LEGACY_SHA = /^[0-9a-f]{64}$/;

export interface RekeyContext {
  readonly db: AppDatabase;
  readonly config: Config;
  readonly logger: Logger;
  readonly dryRun: boolean;
}

/** Exported for tests; the CLI command wraps this in the offline runtime. */
export async function runRekeyLegacyBlobs(ctx: RekeyContext): Promise<number> {
  const { db, logger, dryRun } = ctx;
  const report = { scanned: 0, moved: 0, skipped: 0, failed: 0 };

  const rows = await db
    .select({
      id: files.id,
      sha256: files.sha256,
      mimetype: files.mimetype,
      storageDriver: files.storageDriver,
      storageKey: files.storageKey,
    })
    .from(files)
    .all();

  for (const row of rows) {
    report.scanned++;

    // Quarantined rows have no backing bytes to move; rescan heals them onto
    // whatever key they already carry.
    if (row.storageDriver.startsWith(QUARANTINED_DRIVER_PREFIX)) {
      report.skipped++;
      continue;
    }
    // Only rows still on the retired content-addressed key are candidates.
    if (!LEGACY_SHA.test(row.sha256) || row.storageKey !== legacyContentAddressedKey(row.sha256)) {
      report.skipped++;
      continue;
    }

    const newKey = newStorageKey(row.id, ulidTimeMs(row.id) ?? Date.now());
    if (dryRun) {
      logger.info({ fileId: row.id, from: row.storageKey, to: newKey, driver: row.storageDriver }, "rekey (dry-run): would move");
      report.moved++;
      continue;
    }

    try {
      const driver = getDriver(row.storageDriver);
      const stream = await driver.getStream(row.storageKey);
      const bytes = await new Response(stream).arrayBuffer();
      await driver.put(newKey, bytes, { contentType: row.mimetype });
      if (!(await driver.exists(newKey)))
        throw new Error("copy did not land at the new key");
      await db.update(files).set({ storageKey: newKey }).where(eq(files.id, row.id)).run();
      await driver.delete(row.storageKey);
      report.moved++;
      logger.info({ fileId: row.id, from: row.storageKey, to: newKey, driver: row.storageDriver }, "rekey: moved");
    }
    catch (err) {
      // Row stays on its old key and keeps serving; re-run after fixing.
      report.failed++;
      logger.warn(
        { fileId: row.id, key: row.storageKey, driver: row.storageDriver, err: err instanceof Error ? err.message : String(err) },
        "rekey: move failed; row left on its legacy key",
      );
    }
  }

  logger.info(report, dryRun ? "rekey dry-run complete" : "rekey complete");
  consola.info(`rekey ${dryRun ? "dry-run " : ""}complete: scanned=${report.scanned} moved=${report.moved} skipped=${report.skipped} failed=${report.failed}`);
  return report.failed > 0 ? 1 : 0;
}

export const rekeyLegacyBlobsCommand: CliCommand = {
  command: "script:rekey-legacy-blobs",
  description: "One-shot script (CHORE-004): move pre-v0.3.0 blobs from ab/cd/<sha256> keys to the hour-bucketed YYYYMMDDHH/<ulid> layout. Idempotent; supports --dry-run.",
  options: [{ flag: "--dry-run", description: "Report what would move without writing anything" }],
  async run(_args, opts) {
    return withRuntime(ctx => runRekeyLegacyBlobs({ ...ctx, dryRun: opts.dryRun === true }));
  },
};
