import type { BackupContribution } from "@/modules/backup/registry";
import { hrColleagues } from "./schema";

// hr_colleagues.user_id references users.id, so the users module must
// be restored first (and deleted after) — hence the `users` dependency.
export const hrBackupContribution: BackupContribution = {
  name: "hr",
  tables: [hrColleagues],
  deps: ["users"],
};
