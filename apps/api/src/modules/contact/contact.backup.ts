import type { BackupContribution } from "@/modules/backup/registry";
import { contacts, contactTags } from "./schema";

export const contactBackupContribution: BackupContribution = {
  name: "contacts",
  // contacts must precede contact_tags because contact_tags.contact_id → contacts.id.
  tables: [contacts, contactTags],
  // contact_tags.tag_id → tags.id; the `tags` table is owned by the dedicated
  // tags contribution. contacts.owner_id is plain text (no FK), and
  // owner/viewer relation tuples are exported by the policies contribution.
  deps: ["tags"],
};
