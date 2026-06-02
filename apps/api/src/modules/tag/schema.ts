import { index, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Domains that own a tag vocabulary. The discriminator scopes uniqueness so
// each domain keeps an independent namespace within one shared table.
export const TAG_TYPES = ["project", "contact", "document", "issue", "procurement", "ship"] as const;
export type TagType = typeof TAG_TYPES[number];

// Central, type-scoped tag vocabulary. Owned here (not by the project module)
// so project, contact, document, issue, and procurement assignments share one
// table without importing each other. `name` is unique per `type`, not globally.
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  type: text("type", { enum: TAG_TYPES }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("tags_type_name_idx").on(t.type, t.name)]);

// The single, generic tag-assignment join. Replaces the five per-domain join
// tables (project_tags / contact_tags / issue_tags / document_tags /
// procurement_tags). `resource_id` is the owning resource's id (project id /
// contact id / item id) and carries NO foreign key — it is polymorphic across
// domains — so resource hard-deletes clean their rows app-level. `tag_id`
// cascades from `tags`, so deleting a tag still unlinks every assignment.
export const tagsRefs = sqliteTable("tags_refs", {
  resourceId: text("resource_id").notNull(),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, t => [
  primaryKey({ columns: [t.resourceId, t.tagId] }),
  index("tags_refs_tag_id_idx").on(t.tagId),
]);
