import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { fileReferences } from "@/modules/file/schema";

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

/**
 * The pseudo-section every project always has. It is not a mountable section
 * (no `project_sections` row): it names the core record — metadata, members,
 * roles, the sub-project hierarchy — so `CAPABILITY_SECTION` can map the
 * project-admin capabilities somewhere without inventing a mount.
 */
export const PROJECT_CORE_SECTION = "core";

/**
 * Which section each capability belongs to (PLAN-108 §4). Capabilities stay
 * ONE flat literal — roles validate their JSON array against it — and this
 * sibling map tags each entry so the Roles editor can group capabilities by
 * section and hide the ones whose section a project has not mounted.
 * `PROJECT_CORE_SECTION` marks the capabilities that exist for every project.
 */
export const CAPABILITY_SECTION: Record<ProjectCapability, string> = {
  "issue.view": "issues",
  "issue.comment": "issues",
  "issue.manage": "issues",
  "procurement.view": "procurement",
  "procurement.comment": "procurement",
  "procurement.manage": "procurement",
  "files.view": "files",
  "files.manage": "files",
  // Procurement categories are procurement-domain data (PLAN-108 §3).
  "categories.manage": "procurement",
  "members.manage": PROJECT_CORE_SECTION,
  "roles.manage": PROJECT_CORE_SECTION,
  "project.manage": PROJECT_CORE_SECTION,
};

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // ulid
  shortId: text("short_id").notNull(), // nanoid, exposed in URL/API
  code: text("code").notNull(), // human-readable, unique
  name: text("name").notNull(),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  description: text("description"),
  // Sub-project link. ONE level only — a project that has a parent cannot
  // itself become a parent — and that rule is enforced in the service, not by
  // the DB. ON DELETE SET NULL: children are unlinked, never cascade-deleted.
  parentId: text("parent_id").references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
  // Optional cover image: a `file_references` row with owner_type
  // 'project_cover'. Nulled automatically when that reference is released.
  coverReferenceId: text("cover_reference_id").references((): AnySQLiteColumn => fileReferences.id, { onDelete: "set null" }),
  // ON DELETE RESTRICT (not cascade): a user must not silently hard-delete every
  // project they created — that DB cascade cannot reach `tags_refs` (no FK on
  // `resource_id`), so it would permanently orphan tag links. Account deletion
  // must route through a service that reassigns/soft-deletes owned projects and
  // calls `deleteResourceTags`. See docs/decisions/008.
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("projects_short_id_idx").on(t.shortId),
  uniqueIndex("projects_code_idx").on(t.code),
  index("projects_status_idx").on(t.status, t.deletedAt),
  index("projects_parent_idx").on(t.parentId),
]);

// Mounted sections, per project (PLAN-108 §2). A row present = that section is
// mounted; the absence of a row = it is not. This table is the single source of
// truth for what a project *is* — there is no `type` column, a project that has
// `ship-profile` mounted IS a ship. Sections own their own tables, routes and
// capabilities in their own modules; the only data the project core keeps about
// them is this mount row plus its display order.
export const projectSections = sqliteTable("project_sections", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [
  primaryKey({ columns: [t.projectId, t.key] }),
  // Key-first: answers "every project with the ship-profile section mounted".
  index("project_sections_key_idx").on(t.key, t.projectId),
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

// Members are OPERATORS — they can be assigned issues / procurement. Every
// member maps to a `users` row (real or virtual); `userId` is required. `id` is
// the canonical assignment target. Member display name comes from the joined user.
export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(), // nanoid — assignment target for issues/procurement
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => projectRoles.id, { onDelete: "restrict" }),
  title: text("title"), // job title / trade, display only
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("project_members_project_idx").on(t.projectId),
  index("project_members_role_idx").on(t.roleId),
  // Standalone userId index: lookups filtering by userId alone (project list
  // member scope, issue search scope, isMember) cannot use the composite unique
  // index below where userId is the trailing column.
  index("project_members_user_idx").on(t.userId),
  // One row per user per project.
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
