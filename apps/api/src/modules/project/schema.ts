import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

export const PROJECT_STATUSES = ["active", "archived", "closed"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const MEMBER_TYPES = ["internal", "external"] as const;
export type MemberType = typeof MEMBER_TYPES[number];

export const MEMBER_ROLES = ["pm", "member"] as const;
export type MemberRole = typeof MEMBER_ROLES[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // ulid
  shortId: text("short_id").notNull(), // nanoid, exposed in URL/API
  code: text("code").notNull(), // human-readable, unique
  name: text("name").notNull(),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  description: text("description"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("projects_short_id_idx").on(t.shortId),
  uniqueIndex("projects_code_idx").on(t.code),
  index("projects_status_idx").on(t.status, t.deletedAt),
]);

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(), // nanoid — the canonical assignment target for issues/procurement
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  memberType: text("member_type", { enum: MEMBER_TYPES }).notNull(),
  role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // internal only
  displayName: text("display_name"), // external
  externalRef: text("external_ref"), // external system / webhook id
  supplierInfo: text("supplier_info"), // JSON string: { contact, ... }
  canViewProcurement: integer("can_view_procurement").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("project_members_project_idx").on(t.projectId),
  index("project_members_user_idx").on(t.userId),
  uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId), // one row per real user per project
]);
