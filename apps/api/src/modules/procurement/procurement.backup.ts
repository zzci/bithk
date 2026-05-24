import type { BackupContribution } from "@/modules/backup/registry";
import { procurementDetails } from "./schema";

export const procurementBackupContribution: BackupContribution = {
  name: "procurements",
  tables: [procurementDetails],
  // procurement_details FK → items.id (sub-type), projects.id (scope),
  // contacts.id (global supplier), procurement_categories.id (category) and
  // project_members.id (assignee). The base `items` rows and the policy tuples
  // carrying owner state come from the `items` / `policies` contributions; the
  // project-owned tables (projects, categories, members) come from the
  // `projects` contribution. Global contacts are owned by the contact module;
  // this contribution keeps exporting supplier_id as procurement metadata.
  deps: ["items", "policies", "projects"],
};
