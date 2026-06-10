import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

export const HR_COLLEAGUE_STATUSES = ["active", "archived"] as const;
export type HrColleagueStatus = typeof HR_COLLEAGUE_STATUSES[number];

// An HR colleague is an internal staff member linked to exactly one
// `users` row (real or virtual). Deletion archives the row (`status`)
// instead of removing it, so future HR records can keep referencing
// the actor. `user_id` uses ON DELETE RESTRICT: HR colleague records
// must not silently disappear when a (virtual) user is deleted.
export const hrColleagues = sqliteTable("hr_colleagues", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  code: text("code"),
  title: text("title"),
  department: text("department"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  // One colleague row per user — duplicates surface as a clean 409 in the
  // service pre-check; the index is the hard backstop.
  uniqueIndex("idx_hr_colleagues_user").on(t.userId),
  index("idx_hr_colleagues_status").on(t.status),
]);

export const HR_APPROVAL_TYPES = ["leave", "overtime", "business_trip", "other"] as const;
export type HrApprovalType = typeof HR_APPROVAL_TYPES[number];

export const HR_APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type HrApprovalStatus = typeof HR_APPROVAL_STATUSES[number];

// An approval request filed for a colleague. Once decided (approved or
// rejected) a record is immutable — update, re-decide, and delete are all
// rejected. `colleague_id` uses RESTRICT so approval history never points at
// a vanished colleague; `decided_by` uses SET NULL so deleting the deciding
// admin does not block on (or erase) approval history.
export const hrApprovals = sqliteTable("hr_approvals", {
  id: text("id").primaryKey(),
  colleagueId: text("colleague_id").notNull().references(() => hrColleagues.id, { onDelete: "restrict" }),
  type: text("type", { enum: ["leave", "overtime", "business_trip", "other"] }).notNull(),
  title: text("title").notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decisionNote: text("decision_note"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  index("idx_hr_approvals_status").on(t.status),
  index("idx_hr_approvals_colleague").on(t.colleagueId),
]);

export const HR_PAYROLL_STATUSES = ["pending", "paid"] as const;
export type HrPayrollStatus = typeof HR_PAYROLL_STATUSES[number];

// One payroll record per colleague per `YYYY-MM` period. Amounts are
// integers in the currency's minor unit (procurement convention);
// `net_amount` is computed server-side as base + bonus - deduction.
// `currency` is a 3-letter uppercase ISO-style code validated by format,
// not an enum — multi-currency support without schema changes. Paid records
// are immutable and the pending -> paid transition is one-way.
export const hrPayrollRecords = sqliteTable("hr_payroll_records", {
  id: text("id").primaryKey(),
  colleagueId: text("colleague_id").notNull().references(() => hrColleagues.id, { onDelete: "restrict" }),
  period: text("period").notNull(),
  baseSalary: integer("base_salary").notNull(),
  bonus: integer("bonus").notNull().default(0),
  deduction: integer("deduction").notNull().default(0),
  currency: text("currency").notNull(),
  netAmount: integer("net_amount").notNull(),
  status: text("status", { enum: ["pending", "paid"] }).notNull().default("pending"),
  paidAt: text("paid_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  // One record per colleague per period — duplicates surface as a clean 409
  // in the service pre-check; the index is the hard backstop.
  uniqueIndex("idx_hr_payroll_colleague_period").on(t.colleagueId, t.period),
  index("idx_hr_payroll_status").on(t.status),
  index("idx_hr_payroll_period").on(t.period),
]);
