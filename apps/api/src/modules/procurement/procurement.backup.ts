import type { BackupContribution } from "@/modules/backup/registry";
import { globalProcurementCategories, procurementCategories, procurementDetails } from "./schema";

export const procurementBackupContribution: BackupContribution = {
  name: "procurements",
  // The global category vocabulary leads (no outbound FK), then the per-project
  // copies, then the procurements that reference them: per-module insert order
  // alone satisfies the FK chain within this contribution (PLAN-108 §3).
  tables: [globalProcurementCategories, procurementCategories, procurementDetails],
  // procurement_details FK → items.id (sub-type), projects.id (scope),
  // contacts.id (global supplier), procurement_categories.id (category) and
  // project_members.id (assignee). The base `items` rows and the policy tuples
  // carrying owner state come from the `items` / `policies` contributions; the
  // project-owned tables (projects, members) come from the `projects`
  // contribution — which the `projects` dep also puts ahead of
  // `procurement_categories.project_id`. Global contacts are owned by the
  // contact module; this contribution keeps exporting supplier_id as
  // procurement metadata.
  deps: ["items", "policies", "projects"],
};
