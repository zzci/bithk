import type { BackupContribution } from "@/modules/backup/registry";
import { equipmentManufacturers, globalEquipmentCategories, shipEquipment, shipEquipmentCategories, shipProfiles, worklists } from "./schema";

export const shipBackupContribution: BackupContribution = {
  name: "ships",
  // Parent tables first. `global_equipment_categories` and
  // `equipment_manufacturers` are standalone templates (no FKs);
  // `equipment_manufacturers` precedes `ship_equipment` (whose manufacturer_id
  // FK points there), and `ship_equipment_categories` precedes `ship_equipment`
  // (its category_id FK points there). Every remaining table hangs off
  // `projects` by `project_id`, so `projects` is a one-way dependency: the
  // pre-fold `projects ↔ ships` cycle is gone with `projects.ship_id`
  // (PLAN-108 §7).
  tables: [globalEquipmentCategories, equipmentManufacturers, shipProfiles, shipEquipmentCategories, shipEquipment, worklists],
  deps: ["users", "projects"],
};
