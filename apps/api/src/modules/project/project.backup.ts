import type { BackupContribution } from "@/modules/backup/registry";
import { globalProcurementCategories, procurementCategories, projectMembers, projectRoles, projects, projectSections } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent tables first so per-module insert order alone satisfies foreign keys:
  // projects → roles/members/sections/categories (FK project_id). project_members.role_id
  // → project_roles, so roles precede members. `project_sections` carries the
  // section mounts (PLAN-108) — the rows that give a restored project its tabs;
  // it FKs project_id, so it trails `projects`. Project tag assignments live in
  // the shared `tags_refs` table, owned by the `tags` backup contribution.
  // `global_procurement_categories` is the global vocabulary the per-project
  // `procurement_categories` are copied from (mirrors `global_equipment_categories`
  // in the ship contribution); it has no project FK, so it leads.
  tables: [globalProcurementCategories, projects, projectRoles, projectMembers, projectSections, procurementCategories],
  // Project tag assignments live in the shared `tags_refs` table (the `tags`
  // module), listed as a dep so a projects-only export carries them too.
  // `ships` is NOT a dep: with `projects.ship_id` gone the ship contribution
  // depends on `projects` one way only, so the old cycle is dead (PLAN-108 §7).
  deps: ["users", "tags"],
};
