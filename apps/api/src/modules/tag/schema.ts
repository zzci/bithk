import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Domains that own a tag vocabulary. The discriminator scopes uniqueness so
// each domain keeps an independent namespace within one shared table.
export const TAG_SOURCE_TYPES = ["project", "contact", "document", "issue", "procurement"] as const;
export type TagSourceType = typeof TAG_SOURCE_TYPES[number];

// Central, type-scoped tag vocabulary. Owned here (not by the project module)
// so project, contact, and document assignment joins share one table without
// importing each other. `name` is unique per `source_type`, not globally.
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  sourceType: text("source_type", { enum: TAG_SOURCE_TYPES }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("tags_source_name_idx").on(t.sourceType, t.name)]);
