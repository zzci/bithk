import type { BackupContribution } from "@/modules/backup/registry";
import { projectMembers, projectRoles, projects, projectSections } from "./schema";

export const projectBackupContribution: BackupContribution = {
  name: "projects",
  // Parent tables first so per-module insert order alone satisfies foreign keys:
  // projects → roles/members/sections (FK project_id). project_members.role_id
  // → project_roles, so roles precede members. `project_sections` carries the
  // section mounts (PLAN-108) — the rows that give a restored project its tabs;
  // it FKs project_id, so it trails `projects`. Project tag assignments live in
  // the shared `tags_refs` table, owned by the `tags` backup contribution.
  // The two category tables that used to sit here moved to the `procurement`
  // contribution (PLAN-108 §3): they are procurement-domain data. That
  // contribution already deps on `projects`, so its per-project rows still
  // restore after the `projects` rows their `project_id` points at.
  tables: [projects, projectRoles, projectMembers, projectSections],
  // Project tag assignments live in the shared `tags_refs` table (the `tags`
  // module), listed as a dep so a projects-only export carries them too.
  // `ships` is NOT a dep: with `projects.ship_id` gone the ship contribution
  // depends on `projects` one way only, so the old cycle is dead (PLAN-108 §7).
  deps: ["users", "tags"],
};
