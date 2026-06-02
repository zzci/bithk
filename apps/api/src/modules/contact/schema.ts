import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CONTACT_STATUSES = ["active", "inactive"] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export const CONTACT_VISIBILITIES = ["private", "public"] as const;
export type ContactVisibility = typeof CONTACT_VISIBILITIES[number];

// Global, admin-maintained contact categories. A standalone vocabulary (not
// copied per-project, unlike procurement categories). Declared above `contacts`
// so the `category_id` foreign key resolves.
export const contactCategories = sqliteTable("contact_categories", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), // nanoid
  ownerId: text("owner_id").notNull(), // creator user id
  name: text("name").notNull(),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  taxId: text("tax_id"),
  note: text("note"),
  categoryId: text("category_id").references(() => contactCategories.id, { onDelete: "set null" }),
  status: text("status", { enum: CONTACT_STATUSES }).notNull().default("active"),
  visibility: text("visibility", { enum: CONTACT_VISIBILITIES }).notNull().default("private"),
  confidential: integer("confidential", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("contacts_owner_idx").on(t.ownerId)]);

// Contact tag assignments live in the shared `tags_refs` join (tag module),
// keyed by `resource_id = contacts.id`, scoped to tag `type` 'contact'.
