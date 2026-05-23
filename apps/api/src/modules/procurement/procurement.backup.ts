import type { BackupContribution } from "@/modules/backup/registry";
import { procurementDetails } from "./schema";

export const procurementBackupContribution: BackupContribution = {
  name: "procurements",
  tables: [procurementDetails],
  // procurement_details FK → items.id (sub-type), projects.id (scope),
  // project_contacts.id (supplier), procurement_categories.id (category) and
  // project_members.id (assignee). The base `items` rows and the policy tuples
  // carrying owner state come from the `items` / `policies` contributions; the
  // project-owned tables (projects, contacts, categories, members) all come
  // from the `projects` contribution. Listing them as deps keeps the
  // topological insert order correct on restore.
  deps: ["items", "policies", "projects"],
};
