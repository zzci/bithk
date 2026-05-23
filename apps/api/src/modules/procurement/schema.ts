import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { items } from "@/modules/item/schema";
import { projectMembers, projects } from "@/modules/project/schema";

export const PROCUREMENT_STATUSES = ["draft", "requested", "ordered", "received", "closed"] as const;
export type ProcurementStatus = typeof PROCUREMENT_STATUSES[number];

// `procurement` is a sub-type of the `item` base. The base owns the universal
// columns (title / status / creator / version / soft-delete / timestamps) and
// the comments / attachments machinery; this table holds only the
// procurement-specific business fields.
//
// What lives in `items` (base, queried via ItemService):
//   - id, short_id, type='procurement', title, status, creator_id, version,
//     deleted_at, updated_at
//
// Assignment targets (`supplier_member_id` / `assignee_member_id`) reference
// `project_members.id` — the project owns the membership directory; ON DELETE
// SET NULL keeps a procurement row addressable when a member is removed.
export const procurementDetails = sqliteTable("procurement_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierMemberId: text("supplier_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity"),
  amount: integer("amount"), // minor currency unit
  currency: text("currency"),
}, t => [index("procurement_project_idx").on(t.projectId)]);
