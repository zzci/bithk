import type { CliCommand } from "./types";
import { consola } from "consola";
import { syncSpreadsheetsToDb } from "@/modules/file/storage.service";
import { withRuntime } from "./runtime";

// FEAT-054: move Univer spreadsheets (application/x-univer-sheet) off local/s3
// back onto the `db` driver, where the live-editable snapshot belongs.
// Historical rows can sit on `local` (pre-db-driver, or restored from a
// backup). Idempotent, resumable; the `db` driver is always available so no
// storage config is required.

export const migrateSheetsToDbCommand: CliCommand = {
  command: "script:migrate-sheets-to-db",
  description: "One-shot script (FEAT-054): move Univer spreadsheets off local/s3 onto the db driver (where the live-editable snapshot belongs). Idempotent; supports --dry-run.",
  options: [{ flag: "--dry-run", description: "Report what would move without reading, writing, or repointing" }],
  async run(_args, opts) {
    return withRuntime(async ({ db, logger }) => {
      const dryRun = opts.dryRun === true;
      const summary = await syncSpreadsheetsToDb(db, {
        dryRun,
        onProgress: (e) => {
          if (e.kind === "moved")
            logger.info({ fileId: e.id, from: e.from, to: e.to }, dryRun ? "migrate-sheets (dry-run): would move" : "migrate-sheets: moved");
          else if (e.kind === "failed")
            logger.warn({ fileId: e.id, from: e.from, err: e.err }, "migrate-sheets: move failed; row left on its current driver");
        },
      });
      consola.info(`migrate-sheets ${dryRun ? "dry-run " : ""}complete: moved=${summary.moved} skipped=${summary.skipped} failed=${summary.failed}`);
      return summary.failed > 0 ? 1 : 0;
    });
  },
};
