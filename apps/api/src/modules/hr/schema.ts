import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
