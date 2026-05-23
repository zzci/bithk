import type { BackupContribution } from "@/modules/backup/registry";
import { driveEntries, driveFileVersions, teamDirectories, teamDirectoryMembers } from "./schema";

export const driveBackupContribution: BackupContribution = {
  name: "drive",
  // Parent tables first so per-module insert order alone satisfies foreign keys.
  // team_directories before its members; drive_entries before its version children.
  // Shares now live in the `share` module's backup contribution.
  tables: [teamDirectories, teamDirectoryMembers, driveEntries, driveFileVersions],
  deps: ["users", "files"],
};
