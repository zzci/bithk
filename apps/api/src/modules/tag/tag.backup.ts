import type { BackupContribution } from "@/modules/backup/registry";
import { tags, tagsRefs } from "./schema";

// `tags` is the shared, type-scoped vocabulary; `tags_refs` is the single
// generic assignment join. `tags` has no outbound FKs, so it must be inserted
// first; `tags_refs.tag_id` → tags.id, so it follows in the same contribution.
// `tags_refs.resource_id` carries no FK, so no domain ordering applies to it.
export const tagBackupContribution: BackupContribution = {
  name: "tags",
  tables: [tags, tagsRefs],
  deps: [],
};
