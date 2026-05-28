import type { BackupContribution } from "@/modules/backup/registry";
import { tags } from "./schema";

// `tags` is the shared, type-scoped vocabulary. It has no outbound FKs, so it
// has no deps and must be inserted before every domain join table that points
// at it (project_tags, contact_tags, document_tags). Those domains list "tags"
// as a dep to enforce that ordering.
export const tagBackupContribution: BackupContribution = {
  name: "tags",
  tables: [tags],
  deps: [],
};
