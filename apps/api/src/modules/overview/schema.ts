import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

// Favoritable target kinds. The table is deliberately generic: adding a new
// kind is a registry entry + a hydrator in `overview.service.ts` — no schema
// change and no column on the target's own table (FEAT-048).
export const FAVORITE_TARGET_TYPES = ["project", "issue", "procurement"] as const;
export type FavoriteTargetType = typeof FAVORITE_TARGET_TYPES[number];

// Per-user favorites pinned on the overview workbench. Standalone on purpose:
// no FK into target tables (`target_id` is the target's INTERNAL id —
// `projects.id` or `items.id`), so favoriting never touches another module's
// schema. Rows whose target was hard-deleted are pruned lazily on read; rows
// the caller can no longer view are kept but omitted from responses.
export const userFavorites = sqliteTable("user_favorites", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type", { enum: FAVORITE_TARGET_TYPES }).notNull(),
  targetId: text("target_id").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, t => [
  // Also serves the only read path (list by user) via the PK prefix.
  primaryKey({ columns: [t.userId, t.targetType, t.targetId] }),
]);
