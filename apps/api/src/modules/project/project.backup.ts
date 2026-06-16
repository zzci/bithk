import type { BackupContribution } from "@/modules/backup/registry";
import { globalProcurementCategories, procurementCategories, projectMembers, projectRoles, projects } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent tables first so per-module insert order alone satisfies foreign keys:
  // projects → roles/members/categories (FK project_id). project_members.role_id
  // → project_roles, so roles precede members. Project tag assignments live in
  // the shared `tags_refs` table, owned by the `tags` backup contribution.
  // `global_procurement_categories` is the global vocabulary the per-project
  // `procurement_categories` are copied from (mirrors `global_equipment_categories`
  // in the ship contribution); it has no project FK, so it leads.
  tables: [globalProcurementCategories, projects, projectRoles, projectMembers, procurementCategories],
  // `projects.ship_id` → ships, so ships must be inserted before projects.
  // Project tag assignments live in the shared `tags_refs` table (the `tags`
  // module), listed as a dep so a projects-only export carries them too.
  deps: ["users", "ships", "tags"],
};
