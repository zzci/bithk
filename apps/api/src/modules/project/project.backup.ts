import type { BackupContribution } from "@/modules/backup/registry";
import { projectMembers, projects } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent table first so per-module insert order alone satisfies foreign keys:
  // projects before project_members (FK project_id → projects.id).
  tables: [projects, projectMembers],
  deps: ["users"],
};
