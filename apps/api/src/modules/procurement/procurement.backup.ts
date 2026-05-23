import type { BackupContribution } from "@/modules/backup/registry";
import { procurementDetails } from "./schema";

export const procurementBackupContribution: BackupContribution = {
  name: "procurements",
  tables: [procurementDetails],
  // procurement_details FK → items.id (sub-type), projects.id (scope) and
  // project_members.id (assignment targets). The base `items` rows and the
  // policy tuples carrying owner state come from the `items` / `policies`
  // contributions; projects come from `projects`. Listing them as deps keeps
  // the topological insert order correct on restore.
  deps: ["items", "policies", "projects"],
};
