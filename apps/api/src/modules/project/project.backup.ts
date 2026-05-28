import type { BackupContribution } from "@/modules/backup/registry";
import { procurementCategories, projectMembers, projectRoles, projects, projectTags } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent tables first so per-module insert order alone satisfies foreign keys:
  // projects → roles/members/categories (FK project_id). project_members.role_id
  // → project_roles, so roles precede members. project_tags.tag_id → tags, which
  // the `tags` module owns and is listed as a dep.
  tables: [projects, projectRoles, projectMembers, procurementCategories, projectTags],
  // `projects.ship_id` → ships, so ships must be inserted before projects.
  // `tags` provides the vocabulary that project_tags references.
  deps: ["users", "ships", "tags"],
};
