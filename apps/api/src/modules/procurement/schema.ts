import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { contacts } from "@/modules/contact/schema";
import { items } from "@/modules/item/schema";
import { procurementCategories, projectMembers, projects } from "@/modules/project/schema";
import { tags } from "@/modules/tag/schema";

export const PROCUREMENT_STATUSES = ["requested", "ordered", "confirmed", "in_transit", "received", "accepted", "cancelled"] as const;
export type ProcurementStatus = typeof PROCUREMENT_STATUSES[number];

// Issue-parity priority levels, mirroring `issue_details.priority` exactly.
export const PROCUREMENT_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type ProcurementPriority = typeof PROCUREMENT_PRIORITIES[number];

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
// any global contact. It is NOT project-scoped and carries no contact type
// requirement. `assignee_member_id` is the responsible operator and references
// `project_members.id`. `category_id` classifies the line item. All three use
// ON DELETE SET NULL so a procurement row stays addressable when a referenced
// row is removed.
export const procurementDetails = sqliteTable("procurement_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierId: text("supplier_id").references(() => contacts.id, { onDelete: "set null" }),
  categoryId: text("category_id").references(() => procurementCategories.id, { onDelete: "set null" }),
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity"),
  amount: integer("amount"), // minor currency unit
  currency: text("currency"),
  // Issue-parity fields mirroring `issue_details` exactly so the procurement
  // detail UI reaches feature parity with the project issue detail.
  description: text("description"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  dueDate: text("due_date"),
}, t => [index("procurement_project_idx").on(t.projectId)]);

// Procurement ⇄ global tag assignment (source_type='procurement'). Mirrors
// `issue_tags`: a composite-PK join from a procurement's `items.id` to the
// shared, type-scoped tag vocabulary. Both sides cascade so deleting a
// procurement or a tag unlinks the assignment automatically.
export const procurementTags = sqliteTable("procurement_tags", {
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.itemId, t.tagId] })]);
