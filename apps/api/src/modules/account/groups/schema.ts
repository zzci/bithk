import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Module grants (FEAT-032): JSON string[] of MODULE_KEYS. A user's visible
  // modules are the UNION over their groups; admins bypass. Empty = the group
  // grants nothing (pure sharing/collaboration group).
  modules: text("modules").notNull().default("[]"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("idx_groups_name").on(t.name),
]);
