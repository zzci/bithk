import type { BackupContribution } from "@/modules/backup/registry";
import { procurementCategories, projectMembers, projectRoles, projects, projectTags, tags } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent tables first so per-module insert order alone satisfies foreign keys:
  // projects → roles/members/categories (FK project_id), and tags before
  // project_tags (FK tag_id). project_members.role_id → project_roles, so roles
  // precede members.
  tables: [projects, projectRoles, projectMembers, procurementCategories, tags, projectTags],
  // `projects.ship_id` → ships, so ships must be inserted before projects.
  deps: ["users", "ships"],
};
