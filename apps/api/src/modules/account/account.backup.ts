import type { BackupContribution } from "@/modules/backup/registry";
import { groups } from "@/modules/account/groups/schema";
import { apiTokens } from "@/modules/account/tokens/schema";
import { userPreferences, users } from "@/modules/account/users/schema";

// One backup row per meta-module — users + groups + per-user preferences +
// the users' Personal Access Tokens stay together so an import never separates
// membership from members, nor drops the PATs that keep API clients (including
// virtual-user automation) authenticated after a restore. `apiTokens` is listed
// after `users` because each token row references a user (FK restore order).
// `name` is the stable identifier in backup files; renaming it is a
// breaking change (bump `BACKUP_FORMAT_VERSION` in backup/archive.service.ts).
export const accountBackupContribution: BackupContribution = {
  name: "users",
  tables: [users, groups, userPreferences, apiTokens],
  deps: [],
};
