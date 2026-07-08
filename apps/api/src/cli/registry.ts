import type { CliCommand } from "./types";
import { backupBlobRescanCommand } from "./backup-blob-rescan";
import { backupExportCommand } from "./backup-export";
import { backupImportCommand } from "./backup-import";
import { healthcheckCommand } from "./healthcheck";
import { migrateCommand } from "./migrate";
import { migrateAllToS3Command } from "./script-migrate-all-to-s3";
import { migrateSheetsToDbCommand } from "./script-migrate-sheets-to-db";
import { rekeyLegacyBlobsCommand } from "./script-rekey-legacy-blobs";

/**
 * Every CLI subcommand this build ships (FEAT-051) — one file per command,
 * registered here. The list versions with the release: add an entry to ship
 * a command, drop it to retire one. One-shot operational scripts use the
 * `script:` name prefix so `--help` groups them apart from the long-lived
 * operator tooling.
 */
export const cliCommands: readonly CliCommand[] = [
  healthcheckCommand,
  migrateCommand,
  backupExportCommand,
  backupImportCommand,
  backupBlobRescanCommand,
  rekeyLegacyBlobsCommand,
  migrateAllToS3Command,
  migrateSheetsToDbCommand,
];
