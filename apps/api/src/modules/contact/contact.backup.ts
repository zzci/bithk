import type { BackupContribution } from "@/modules/backup/registry";
import { contacts } from "./schema";

export const contactBackupContribution: BackupContribution = {
  name: "contacts",
  tables: [contacts],
  // Contact tag assignments live in the shared `tags_refs` table, owned by the
  // `tags` backup contribution — listed as a dep so a contacts-only export still
  // carries the vocabulary and its assignment links. contacts.owner_id is plain
  // text (no FK), and owner/viewer relation tuples come from the policies module.
  deps: ["tags"],
};
