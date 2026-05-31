import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { fileReferences } from "@/modules/file/schema";
import { ships } from "@/modules/ship/schema";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

// Per-project capabilities. Roles are user-defined (see `project_roles`); each
// role grants a subset of these. Route gates check capabilities, not role names.
// Grouped by module (issue / procurement / files / project-admin) so the
// Roles UI can render them under their respective headings automatically.
export const PROJECT_CAPABILITIES = [
  // Issue module
  "issue.view", // read issue list, detail, and comments
  "issue.comment", // post comments on issues
  "issue.manage", // create / edit / delete / pin / attach any issue
  // Procurement module
  "procurement.view", // read procurement list and detail
  "procurement.comment", // post comments on procurement
  "procurement.manage", // create / edit / delete / transition procurement
  // Files module (project-scoped drive entries)
  "files.view", // list and download project-owned drive entries
  "files.manage", // create / upload / edit / trash / delete project-owned entries
  // Project-level admin caps
  "categories.manage", // maintain procurement categories
  "members.manage", // add / edit / remove members, assign roles
  "roles.manage", // create / edit / delete roles
  "project.manage", // edit metadata, archive, delete the project
] as const;
export type ProjectCapability = typeof PROJECT_CAPABILITIES[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // ulid
  shortId: text("short_id").notNull(), // nanoid, exposed in URL/API
  code: text("code").notNull(), // human-readable, unique
  name: text("name").notNull(),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  description: text("description"),
  // Optional link back to a ship. The base project of a ship points at it; an
  // additionally bound project also sets this. Nullable circular FK — see
  // `ships.baseProjectId`.
  shipId: text("ship_id").references((): AnySQLiteColumn => ships.id, { onDelete: "set null" }),
  // Optional cover image: a `file_references` row with owner_type
  // 'project_cover'. Nulled automatically when that reference is released.
  coverReferenceId: text("cover_reference_id").references((): AnySQLiteColumn => fileReferences.id, { onDelete: "set null" }),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("projects_short_id_idx").on(t.shortId),
  uniqueIndex("projects_code_idx").on(t.code),
  index("projects_status_idx").on(t.status, t.deletedAt),
  index("projects_ship_idx").on(t.shipId),
]);

// User-defined roles, per project. Capabilities are a JSON string[] validated
// against PROJECT_CAPABILITIES. Two implicit system roles are always seeded:
//   kind='owner' (isSystem=1) — all capabilities, undeletable; holds the creator.
//   kind='guest' (isSystem=1) — no capabilities, undeletable; delete-fallback target.
// Editable preset roles (Reader / Commenter / Writer) have kind=null and isSystem=0.
export const projectRoles = sqliteTable("project_roles", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capabilities: text("capabilities").notNull().default("[]"), // JSON string[]
  isSystem: integer("is_system").notNull().default(0),
  // 'owner' | 'guest' | null (null = custom / editable preset)
  kind: text("kind", { enum: ["owner", "guest"] }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("project_roles_project_idx").on(t.projectId)]);

// Members are OPERATORS — they can be assigned issues / procurement. A member
// is either a real user (`userId` set) or a virtual user (own staff without a
// login account: `userId` null, `displayName` set). `id` is the canonical
// assignment target.
export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(), // nanoid — assignment target for issues/procurement
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }), // null = virtual member
  displayName: text("display_name"), // required for virtual members
  roleId: text("role_id").notNull().references(() => projectRoles.id, { onDelete: "restrict" }),
  title: text("title"), // job title / trade, display only
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("project_members_project_idx").on(t.projectId),
  index("project_members_role_idx").on(t.roleId),
  // One row per real user per project. Virtual members carry NULL userId, which
  // SQLite treats as mutually distinct, so multiple virtual members coexist.
  uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId),
]);

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

// Project tag assignments live in the shared `tags_refs` join (tag module),
// keyed by `resource_id = projects.id`, scoped to tag `type` 'project'.
