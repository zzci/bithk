import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { items } from "@/modules/item/schema";

// `document` is a Tier-C sub-type of the `item` base. The base owns the
// universal columns (title / status / creator / version / soft-delete /
// timestamps) and the comments / attachments machinery; this table holds
// only the document-specific business fields.
//
// What lives in `items` (base, queried via ItemService):
//   - id, short_id, type='document', title, status, creator_id, version,
//     deleted_at, updated_at
//
// What does NOT live here on purpose:
//   - collaborator shares → policy tuples in namespace `item` with relations
//     `viewer` / `editor` (subjects: user or group). The policy engine's
//     `parent_item` tuple_to_userset rules give the subtree inheritance
//     for free, so we do not maintain a `document_shares` table for these.
//   - comments → `item_comments`.
//   - attachments → `file_references` with owner_type='item_attachment',
//     owner_id=<items.id>.
//
// What DOES live here: anonymous public links (`document_public_links`).
// Unlike collaborator shares, a public link carries per-link state that a
// policy tuple cannot hold — a secret token, an optional hashed password,
// an expiry, and an active flag — so it gets a dedicated table, mirroring
// drive's `drive_file_shares` public-link design.
//
// `parent_id` lives here as a **business** column (it drives the
// rendered sidebar tree, no permission semantics). The matching
// **permission** edge is a `(item, X, parent_item, item, Y)` tuple that
// the service writes/rewrites in lockstep with this column at the same
// transaction boundary as moves. The two are read for two purposes;
// neither derives the other.
export const documentDetails = sqliteTable("document_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  content: text("content"),
  tags: text("tags").notNull().default("[]"),
  parentId: text("parent_id").references((): AnySQLiteColumn => items.id, { onDelete: "cascade" }),
  commentsLocked: integer("comments_locked", { mode: "boolean" }).notNull().default(false),
}, t => [
  index("idx_document_details_parent").on(t.parentId),
]);

// Anonymous public links to a document item. `password` holds an argon2id
// hash (write-only — never selected back to API clients) and `token` is a
// cryptographically-random secret used as the public URL handle.
export const documentPublicLinks = sqliteTable("document_public_links", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  password: text("password"),
  expiresAt: text("expires_at"),
  isActive: integer("is_active").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("document_public_links_token_idx").on(t.token),
  index("document_public_links_document_idx").on(t.documentId),
  index("document_public_links_created_by_idx").on(t.createdBy),
  index("document_public_links_active_expires_idx").on(t.isActive, t.expiresAt),
]);
