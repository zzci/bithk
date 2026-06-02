import type { BackupContribution } from "@/modules/backup/registry";
import { shipEquipment, ships, worklists } from "./schema";

export const shipBackupContribution: BackupContribution = {
  name: "ships",
  // Parent table first: ships → ship_equipment / worklists
  // (FK ship_id). `projects` is a dep both ways (nullable circular FK
  // ships.base_project_id ↔ projects.ship_id); restore defers FK checks to
  // COMMIT, and the registry tolerates the projects ↔ ships dependency cycle.
  tables: [ships, shipEquipment, worklists],
  deps: ["users", "projects"],
};
