import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { tags } from "@/modules/tag/schema";

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

export const contactTags = sqliteTable("contact_tags", {
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.contactId, t.tagId] })]);
