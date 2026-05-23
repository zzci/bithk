import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

// Resource types that can carry a token-based share. The string lives in
// `shares.resource_type`; the matching adapter (registered by the owning
// module) validates the `resource_id` and renders public content. There is
// deliberately NO database foreign key on `resource_id` — it is polymorphic,
// so cascade cleanup is the owning module's responsibility (see the share
// service's `deleteSharesForResource`, wired into each resource's delete path).
export const SHARE_RESOURCE_TYPES = ["document", "drive_entry"] as const;
export type ShareResourceType = typeof SHARE_RESOURCE_TYPES[number];

export const SHARE_TYPES = ["direct", "public_link"] as const;
export type ShareType = typeof SHARE_TYPES[number];

export const SHARE_PERMISSIONS = ["view", "download", "edit"] as const;
export type SharePermission = typeof SHARE_PERMISSIONS[number];

// One polymorphic table for every token-based share. Replaces the former
// per-module `document_public_links` and `drive_file_shares` tables.
//
// `password` holds an argon2id hash (write-only — never selected back to API
// clients) and `token` is a cryptographically-random secret used as the
// public URL handle. Collaborator (viewer/editor) grants are NOT stored here;
// those remain policy tuples owned by the policy engine.
export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  resourceType: text("resource_type", { enum: SHARE_RESOURCE_TYPES }).notNull(),
  resourceId: text("resource_id").notNull(),
  token: text("token").notNull(),
  shareType: text("share_type", { enum: SHARE_TYPES }).notNull().default("public_link"),
  sharedWithUserId: text("shared_with_user_id").references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission", { enum: SHARE_PERMISSIONS }).notNull().default("view"),
  password: text("password"),
  expiresAt: text("expires_at"),
  maxDownloads: integer("max_downloads"),
  downloadCount: integer("download_count").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("shares_token_idx").on(t.token),
  index("shares_resource_idx").on(t.resourceType, t.resourceId),
  index("shares_created_by_idx").on(t.createdBy),
  index("shares_shared_with_idx").on(t.sharedWithUserId),
  index("shares_share_type_idx").on(t.shareType),
  index("shares_active_expires_idx").on(t.isActive, t.expiresAt),
]);
