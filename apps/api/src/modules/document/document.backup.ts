import type { BackupContribution } from "@/modules/backup/registry";
import { documentDetails, documentPins } from "@/modules/document/schema";

export const documentBackupContribution: BackupContribution = {
  name: "documents",
  // document_pins (user_id → users, item_id → items) preserves per-user pinned
  // documents; both FK targets are inserted first via the deps below.
  tables: [documentDetails, documentPins],
  // document_details FK → items.id; items / item_comments / item_attachments and
  // the policy tuples that carry share + parent_item edges come from the base
  // `items` and `policies` contributions. document_pins.user_id → users.
  // Document tag assignments live in the shared `tags_refs` table (the `tags`
  // module). Listing these as deps keeps the topological insert order correct
  // on restore.
  deps: ["items", "policies", "tags", "users"],
};
