import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CONTACT_STATUSES = ["active", "inactive"] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export const CONTACT_VISIBILITIES = ["private", "public"] as const;
export type ContactVisibility = typeof CONTACT_VISIBILITIES[number];

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
  status: text("status", { enum: CONTACT_STATUSES }).notNull().default("active"),
  visibility: text("visibility", { enum: CONTACT_VISIBILITIES }).notNull().default("private"),
  confidential: integer("confidential", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("contacts_owner_idx").on(t.ownerId)]);

// Contact tag assignments live in the shared `tags_refs` join (tag module),
// keyed by `resource_id = contacts.id`, scoped to tag `type` 'contact'.
