import type { CliCommand } from "./types";
import { consola } from "consola";
import { withRuntime } from "./runtime";

/**
 * Offline `backup:blob-rescan` (FIX-062) — probe every quarantined `files`
 * row against the active storage driver and restore rows whose blob is back
 * (path-correspondence heal after the operator copies the storage tree /
 * bucket). Idempotent; prints `{ scanned, healed, stillMissing }`.
 */
export const backupBlobRescanCommand: CliCommand = {
  command: "backup:blob-rescan",
  description: "Probe quarantined files rows against the storage backend and heal rows whose blob is back (run after copying the storage tree/bucket onto this instance).",
  async run() {
    return withRuntime(async ({ db, logger }) => {
      const { rescanQuarantinedFiles } = await import("../modules/backup/blob-restore");
      const report = await rescanQuarantinedFiles(db, logger);
      consola.success(`blob rescan complete: scanned=${report.scanned} healed=${report.healed} stillMissing=${report.stillMissing}`);
      return 0;
    });
  },
};
