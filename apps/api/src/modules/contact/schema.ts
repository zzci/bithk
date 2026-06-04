import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { fileReferences } from "@/modules/file/schema";

export const CONTACT_STATUSES = ["active", "inactive"] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];

export const CONTACT_VISIBILITIES = ["private", "public"] as const;
export type ContactVisibility = typeof CONTACT_VISIBILITIES[number];

// A contact is one of two kinds. Both kinds share phone, email, website,
// address, taxId, and note; `individual` rows are people that additionally
// carry `position` and optionally belong to an `organization` row, while
// `organization` rows are companies. The discriminator is immutable once a
// row is created.
export const CONTACT_KINDS = ["individual", "organization"] as const;
export type ContactKind = typeof CONTACT_KINDS[number];

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

// Single-table party model: individuals and organizations share one table,
// discriminated by `kind`. Kind-specific columns are nullable and only valid
// for their kind (enforced in the service / route layers, not by the schema).
export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(), // nanoid
  kind: text("kind", { enum: CONTACT_KINDS }).notNull(),
  ownerId: text("owner_id").notNull(), // creator user id
  name: text("name").notNull(),
  note: text("note"),
  // Shared by both kinds: phone, email, website, address, taxId, note.
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  taxId: text("tax_id"),
  address: text("address"),
  // Individual-only fields.
  position: text("position"),
  // Self-reference: an individual may belong to one organization (a contacts
  // row with kind='organization'). ON DELETE SET NULL via AnySQLiteColumn
  // forward ref — deleting the org clears its members' link automatically.
  organizationId: text("organization_id").references((): AnySQLiteColumn => contacts.id, { onDelete: "set null" }),
  // Optional avatar (individual) / logo (organization): a `file_references`
  // row with owner_type 'contact_avatar'. Nulled automatically when that
  // reference is released. Forward ref mirrors project cover_reference_id.
  avatarReferenceId: text("avatar_reference_id").references((): AnySQLiteColumn => fileReferences.id, { onDelete: "set null" }),
  // Free-form extra fields, stored as a flat JSON object string ({} keys/values
  // are all strings). Null when empty.
  attributes: text("attributes"),
  categoryId: text("category_id").references(() => contactCategories.id, { onDelete: "set null" }),
  status: text("status", { enum: CONTACT_STATUSES }).notNull().default("active"),
  visibility: text("visibility", { enum: CONTACT_VISIBILITIES }).notNull().default("private"),
  confidential: integer("confidential", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("contacts_owner_idx").on(t.ownerId),
  index("contacts_kind_idx").on(t.kind),
  index("contacts_org_idx").on(t.organizationId),
]);

// Contact tag assignments live in the shared `tags_refs` join (tag module),
// keyed by `resource_id = contacts.id`, scoped to tag `type` 'contact'.
