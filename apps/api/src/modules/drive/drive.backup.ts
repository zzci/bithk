import type { BackupContribution } from "@/modules/backup/registry";
import { driveEntries, driveFileShares, driveFileVersions, teamDirectories, teamDirectoryMembers } from "./schema";

export const driveBackupContribution: BackupContribution = {
  name: "drive",
  // Parent tables first so per-module insert order alone satisfies foreign keys.
  // team_directories before its members; drive_entries before its version/share children.
  tables: [teamDirectories, teamDirectoryMembers, driveEntries, driveFileVersions, driveFileShares],
  deps: ["users", "files"],
};
