import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

// Per-project capabilities. Roles are user-defined (see `project_roles`); each
// role grants a subset of these. Route gates check capabilities, not role names.
export const PROJECT_CAPABILITIES = [
  "project.manage", // edit metadata, archive, delete the project
  "members.manage", // add / edit / remove members, assign roles
  "roles.manage", // create / edit / delete roles
  "contacts.manage", // maintain external contacts (suppliers, …)
  "categories.manage", // maintain procurement categories
  "procurement.view", // read procurement
  "procurement.manage", // create / edit / delete / transition procurement
  "issue.manage", // edit any issue in the project (beyond own)
] as const;
export type ProjectCapability = typeof PROJECT_CAPABILITIES[number];

export const CONTACT_TYPES = ["supplier", "client", "subcontractor", "other"] as const;
export type ContactType = typeof CONTACT_TYPES[number];

export const CONTACT_STATUSES = ["active", "inactive"] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // ulid
  shortId: text("short_id").notNull(), // nanoid, exposed in URL/API
  code: text("code").notNull(), // human-readable, unique
  name: text("name").notNull(),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  description: text("description"),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("projects_short_id_idx").on(t.shortId),
  uniqueIndex("projects_code_idx").on(t.code),
  index("projects_status_idx").on(t.status, t.deletedAt),
]);

// User-defined roles, per project. Capabilities are a JSON string[] validated
// against PROJECT_CAPABILITIES. The seeded "Project Manager" role is `isSystem`
// (undeletable, capabilities locked to the full set) to prevent lock-out.
export const projectRoles = sqliteTable("project_roles", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capabilities: text("capabilities").notNull().default("[]"), // JSON string[]
  isSystem: integer("is_system").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("project_roles_project_idx").on(t.projectId)]);

// Members are OPERATORS — they can be assigned issues / procurement. A member
// is either a real user (`userId` set) or a virtual user (own staff without a
// login account: `userId` null, `displayName` set). `id` is the canonical
// assignment target. Suppliers are NOT members — they live in `project_contacts`.
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

// External contacts (suppliers / client / subcontractor / …). Reference data
// (metadata) on a project — NOT operators, never an assignment target.
export const projectContacts = sqliteTable("project_contacts", {
  id: text("id").primaryKey(), // nanoid — procurement.supplierId references this
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type", { enum: CONTACT_TYPES }).notNull(),
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxId: text("tax_id"),
  rating: integer("rating"), // 1–5, optional
  status: text("status", { enum: CONTACT_STATUSES }).notNull().default("active"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("project_contacts_project_type_idx").on(t.projectId, t.type)]);

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

// User-defined tags classify projects (global vocabulary, many-to-many). The
// project list filters/groups by tag.
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("tags_name_idx").on(t.name)]);

export const projectTags = sqliteTable("project_tags", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.projectId, t.tagId] })]);
