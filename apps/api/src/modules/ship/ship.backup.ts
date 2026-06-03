import type { BackupContribution } from "@/modules/backup/registry";
import { equipmentCategories, shipEquipment, ships, worklists } from "./schema";

export const shipBackupContribution: BackupContribution = {
  name: "ships",
  // Parent tables first: equipment_categories and ships both precede
  // ship_equipment, which carries FKs to each (category_id, ship_id), so both
  // parents are restored before the child. `projects` is a dep both ways
  // (nullable circular FK ships.base_project_id ↔ projects.ship_id); restore
  // defers FK checks to COMMIT, and the registry tolerates the
  // projects ↔ ships dependency cycle.
  tables: [equipmentCategories, ships, shipEquipment, worklists],
  deps: ["users", "projects"],
};
