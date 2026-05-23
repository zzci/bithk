import type { BackupContribution } from "@/modules/backup/registry";
import { shares } from "./schema";

// The unified `shares` table. `resource_id` is polymorphic (no FK), so the
// only hard dependency is `users` (created_by / shared_with_user_id). This
// also closes the former gap where `document_public_links` was never backed
// up at all.
export const shareBackupContribution: BackupContribution = {
  name: "share",
  tables: [shares],
  deps: ["users"],
};
