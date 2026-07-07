import type { CliCommand } from "./types";
import { consola } from "consola";
import { isS3Configured } from "@/modules/file/storage-config";
import { syncNonSpreadsheetsToS3 } from "@/modules/file/storage.service";
import { withRuntime } from "./runtime";

// FEAT-053: one-shot "consolidate everything onto S3 in the new layout".
// Reuses syncNonSpreadsheetsToS3, which now covers BOTH migrations in one
// pass — local/db blobs move to S3, and S3 blobs still on the legacy
// `ab/cd/<sha256>` key are re-keyed to `YYYYMMDDHH/<ulid>` (original upload
// hour). Idempotent, resumable; spreadsheets and quarantined rows are skipped.
// Requires the S3 driver to be configured (it is the move target).

export const migrateAllToS3Command: CliCommand = {
  command: "script:migrate-all-to-s3",
  description: "One-shot script (FEAT-053): move every local/db blob to S3 AND re-key any legacy ab/cd/<sha> S3 object to the hour-bucketed YYYYMMDDHH/<ulid> layout. Idempotent; supports --dry-run.",
  options: [{ flag: "--dry-run", description: "Report what would move without reading, writing, or repointing" }],
  async run(_args, opts) {
    return withRuntime(async ({ db, logger }) => {
      if (!isS3Configured()) {
        consola.error("S3 is not configured — set the S3 storage driver in the admin Storage settings first.");
        return 2;
      }
      const dryRun = opts.dryRun === true;
      const summary = await syncNonSpreadsheetsToS3(db, {
        dryRun,
        onProgress: (e) => {
          if (e.kind === "moved")
            logger.info({ fileId: e.id, from: e.from, to: e.to }, dryRun ? "migrate (dry-run): would move" : "migrate: moved");
          else if (e.kind === "failed")
            logger.warn({ fileId: e.id, from: e.from, err: e.err }, "migrate: move failed; row left on its current key");
        },
      });
      consola.info(`migrate ${dryRun ? "dry-run " : ""}complete: moved=${summary.moved} skipped=${summary.skipped} failed=${summary.failed}`);
      return summary.failed > 0 ? 1 : 0;
    });
  },
};
