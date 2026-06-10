import type { BackupContribution } from "@/modules/backup/registry";
import { hrApprovals, hrColleagues, hrPayrollRecords } from "./schema";

// hr_colleagues.user_id (and hr_approvals.decided_by) reference users.id, so
// the users module must be restored first (and deleted after) — hence the
// `users` dependency. Within the module, colleagues are listed first because
// approvals and payroll records reference hr_colleagues.id.
export const hrBackupContribution: BackupContribution = {
  name: "hr",
  tables: [hrColleagues, hrApprovals, hrPayrollRecords],
  deps: ["users"],
};
