import type { BackupContribution } from "@/modules/backup/registry";
import { documentDetails, documentTags } from "@/modules/document/schema";

export const documentBackupContribution: BackupContribution = {
  name: "documents",
  tables: [documentDetails, documentTags],
  // document_details / document_tags FK → items.id; items / item_comments /
  // item_attachments and the policy tuples that carry share + parent_item edges
  // come from the base `items` and `policies` contributions. document_tags.tag_id
  // → tags.id, so the `tags` module must be inserted first. Listing these as
  // deps keeps the topological insert order correct on restore.
  deps: ["items", "policies", "tags"],
};
