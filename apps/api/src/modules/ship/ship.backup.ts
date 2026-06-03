import type { BackupContribution } from "@/modules/backup/registry";
import { globalEquipmentCategories, shipEquipment, shipEquipmentCategories, ships, worklists } from "./schema";

export const shipBackupContribution: BackupContribution = {
  name: "ships",
  // Parent tables first. `global_equipment_categories` is a standalone template
  // (no FKs). `ships` precedes both `ship_equipment_categories` and
  // `ship_equipment` (each carries a ship_id FK), and
  // `ship_equipment_categories` precedes `ship_equipment` (its category_id FK
  // points there). `projects` is a dep both ways (nullable circular FK
  // ships.base_project_id ↔ projects.ship_id); restore defers FK checks to
  // COMMIT, and the registry tolerates the projects ↔ ships dependency cycle.
  tables: [globalEquipmentCategories, ships, shipEquipmentCategories, shipEquipment, worklists],
  deps: ["users", "projects"],
};
