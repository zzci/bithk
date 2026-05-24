import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { items } from "@/modules/item/schema";

// Known reference target kinds. The column itself is free `text` so future
// kinds can be added without a migration; this list drives input validation
// and the soft-reference resolver. `maintenance_template` points (refId) at a
// SHIP-LEVEL `maintenance_templates.id` and turns a plain issue into a
// maintenance work order; `url` / `document` are generic attachments.
export const ISSUE_REFERENCE_TYPES = ["maintenance_template", "url", "document"] as const;
export type IssueReferenceType = typeof ISSUE_REFERENCE_TYPES[number];

// Generic, additive references hung off an issue (`items.id`). Deliberately NOT
// part of `issue_details` — issue core (status / assignment / details) stays
// untouched. `refId` is a SOFT reference (no FK): the target may live in another
// module (ship templates, documents) or be an external URL, and may be deleted
// independently, so resolution degrades gracefully instead of cascading.
export const issueReferences = sqliteTable("issue_references", {
  id: text("id").primaryKey(), // nanoid
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  refType: text("ref_type").notNull(), // IssueReferenceType (open-ended)
  refId: text("ref_id").notNull(), // soft reference — NO FK
  label: text("label"),
  createdAt: text("created_at").notNull(),
}, t => [index("issue_references_item_idx").on(t.itemId)]);
