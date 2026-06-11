import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Global roles: app-level module visibility for NON-admin users (admins bypass
// and always see every module). `modules` is a JSON string[] validated against
// MODULE_KEYS (`@/shared/modules`). Exactly one system role is always present
// (boot backfill): kind='default', name "Member" — undeletable, modules
// admin-editable, and the resolution target for `users.global_role_id` NULL.
// Mirrors the proven `project_roles` shape.
export const globalRoles = sqliteTable("global_roles", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  modules: text("modules").notNull().default("[]"), // JSON string[]
  isSystem: integer("is_system").notNull().default(0),
  // 'default' | null (null = custom admin-created role)
  kind: text("kind", { enum: ["default"] }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("global_roles_name_idx").on(t.name)]);
