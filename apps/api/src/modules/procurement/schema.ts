import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { contacts } from "@/modules/contact/schema";
import { items } from "@/modules/item/schema";
import { projectMembers, projects } from "@/modules/project/schema";

export const PROCUREMENT_STATUSES = ["requested", "ordered", "confirmed", "paid", "in_transit", "received", "accepted", "returned", "refunded", "cancelled"] as const;
export type ProcurementStatus = typeof PROCUREMENT_STATUSES[number];

// Item details may be edited only before a procurement is confirmed. Once it
// reaches `confirmed` (and any later or terminal state — including `paid`), the
// item-detail fields are frozen — see `PROCUREMENT_LOCKED_DETAIL_FIELDS` and the
// PATCH guard.
export const PROCUREMENT_EDITABLE_STATUSES = ["requested", "ordered"] as const;

// Item-detail fields that the lock freezes. Workflow fields (description,
// priority, dueDate, tags, assigneeMemberId) stay editable in any status.
export const PROCUREMENT_LOCKED_DETAIL_FIELDS = [
  "itemName",
  "title",
  "supplierId",
  "categoryId",
  "quantity",
  "amount",
  "currency",
] as const;

/** True once a procurement is confirmed or beyond, when item details are frozen. */
export function isProcurementDetailLocked(status: ProcurementStatus): boolean {
  return !(PROCUREMENT_EDITABLE_STATUSES as readonly string[]).includes(status);
}

// Status-transition rules (enforced in `changeStatus`, mirrored in the web
// status picker). Transitions are otherwise free; only these regressions are
// blocked:
//   - once confirmed (confirmed / paid / in_transit / received / accepted), the
//     status cannot return to `ordered` / `requested`;
//   - once `received` / `accepted`, the status cannot be `cancelled`.
// `cancelled` is exempt from the first rule so a cancelled record can be revived.
export function isAllowedProcurementTransition(from: ProcurementStatus, to: ProcurementStatus): boolean {
  const committed = from !== "requested" && from !== "ordered" && from !== "cancelled";
  if (committed && (to === "requested" || to === "ordered"))
    return false;
  if ((from === "received" || from === "accepted") && to === "cancelled")
    return false;
  return true;
}

// ─── Procurement categories ────────────────────────────────────────────
// The classification vocabulary a procurement line item is filed under.
// Procurement-domain data, so it lives in the procurement module and not on
// the project core (PLAN-108 §3); both tables are declared ahead of
// `procurement_details`, which references `procurement_categories.id`.

// Global procurement categories: an admin-maintained template set. Mirrors the
// per-project shape minus `projectId`. Copied into each new project's
// `procurement_categories` at creation time (copy-on-create); later edits here
// do NOT propagate to existing projects, and per-project edits stay independent.
export const globalProcurementCategories = sqliteTable("global_procurement_categories", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Procurement categories, per project (flat).
export const procurementCategories = sqliteTable("procurement_categories", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("procurement_categories_project_idx").on(t.projectId)]);

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
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("low"),
  dueDate: text("due_date"),
}, t => [index("procurement_project_idx").on(t.projectId)]);

// Procurement tag assignments live in the shared `tags_refs` join (tag module),
// keyed by `resource_id = items.id`, scoped to tag `type` 'procurement'.
