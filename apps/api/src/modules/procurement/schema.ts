import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { items } from "@/modules/item/schema";
import { procurementCategories, projectContacts, projectMembers, projects } from "@/modules/project/schema";

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
// `supplier_id` is metadata — the counterparty on the order — and references
// the `project_contacts` directory (a contact of type 'supplier'). It is NOT
// an operator. `assignee_member_id` is the responsible operator and references
// `project_members.id`. `category_id` classifies the line item. All three use
// ON DELETE SET NULL so a procurement row stays addressable when a referenced
// row is removed.
export const procurementDetails = sqliteTable("procurement_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierId: text("supplier_id").references(() => projectContacts.id, { onDelete: "set null" }),
  categoryId: text("category_id").references(() => procurementCategories.id, { onDelete: "set null" }),
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity"),
  amount: integer("amount"), // minor currency unit
  currency: text("currency"),
}, t => [index("procurement_project_idx").on(t.projectId)]);
