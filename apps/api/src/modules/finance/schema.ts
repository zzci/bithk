import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

export const FINANCE_COLLEAGUE_STATUSES = ["active", "archived"] as const;
export type FinanceColleagueStatus = typeof FINANCE_COLLEAGUE_STATUSES[number];

// A finance colleague is an internal finance actor linked to exactly one
// `users` row (real or virtual). Deletion archives the row (`status`)
// instead of removing it, so future finance records can keep referencing
// the actor. `user_id` uses ON DELETE RESTRICT: finance colleague records
// must not silently disappear when a (virtual) user is deleted.
export const financeColleagues = sqliteTable("finance_colleagues", {
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
  uniqueIndex("idx_finance_colleagues_user").on(t.userId),
  index("idx_finance_colleagues_status").on(t.status),
]);
