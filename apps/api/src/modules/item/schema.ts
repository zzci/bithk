import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

// `items.id` is a lowercase Crockford ULID (26 chars). The first 10 chars
// encode the creation timestamp at millisecond resolution, so we do not
// carry a separate `created_at` column — sort by `id DESC` for time-desc
// order, and decode `id.slice(0, 10)` if a wall-clock timestamp is needed.
//
// `items.short_id` is an 8-char nanoid used everywhere the id is exposed
// externally (URLs, audit logs, OpenAPI payloads). It is unique-indexed
// so collisions surface immediately. The shape stays compatible with
// the existing `<module>/<short>` URL conventions.
export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  shortId: text("short_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  // ON DELETE RESTRICT (not cascade): a user must not silently hard-delete every
  // item they created — that DB cascade cannot reach the item's `tags_refs` (no
  // FK on `resource_id`), so it would permanently orphan tag links. Account
  // deletion must route through a service that reassigns/soft-deletes owned
  // items and calls `deleteResourceTags`. See docs/decisions/008.
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  // Pin flag shared by every sub-type (issue, procurement, …). Pinned items
  // surface in the project overview's Pin area. `pinned_at` records when the
  // pin was set so the Pin area can order by most-recently-pinned; it is
  // cleared back to NULL on unpin.
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  pinnedAt: text("pinned_at"),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("idx_items_short_id").on(t.shortId),
  index("idx_items_type_deleted").on(t.type, t.deletedAt),
  index("idx_items_creator_deleted").on(t.creatorId, t.deletedAt),
  index("idx_items_type_status_deleted").on(t.type, t.status, t.deletedAt),
  // Backs the project Pin area: pinned rows ordered by most-recently-pinned.
  index("idx_items_pinned").on(t.pinned, t.pinnedAt),
]);

export const itemComments = sqliteTable("item_comments", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Flat reply reference — clicking the badge in the UI scrolls to the
  // referenced comment, no visual nesting. On parent delete the link is
  // dropped so child comments stay readable.
  replyToId: text("reply_to_id").references((): AnySQLiteColumn => itemComments.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  // 1 = hidden from viewer-only actors; visible to owner / assignee /
  // approver / admin. Sub-types decide who can post these.
  isInternal: integer("is_internal", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  index("idx_item_comments_item").on(t.itemId, t.createdAt),
  index("idx_item_comments_author").on(t.authorId),
  index("idx_item_comments_reply").on(t.replyToId),
]);
