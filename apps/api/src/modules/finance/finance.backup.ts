import type { BackupContribution } from "@/modules/backup/registry";
import { financeColleagues } from "./schema";

// finance_colleagues.user_id references users.id, so the users module must
// be restored first (and deleted after) — hence the `users` dependency.
export const financeBackupContribution: BackupContribution = {
  name: "finance",
  tables: [financeColleagues],
  deps: ["users"],
};
