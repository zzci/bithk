import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";

// Personal Access Tokens (FEAT-034). A long-lived per-user bearer credential so
// a CLI / AI agent can drive the API as the owning user without the browser
// OIDC flow. The plaintext (`bithk_pat_…`) is shown once at creation and stored
// only as a SHA-256 hash; `prefix` keeps a short plaintext fragment for list
// display. `scopes` is a JSON map of token-scope module key → "read" | "write"
// (absent key = no access); enforced as an intersection on top of the owner's
// own policy permissions by `apiTokenScopeGuard`.
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  scopes: text("scopes").notNull().default("{}"),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, t => [
  uniqueIndex("idx_api_tokens_hash").on(t.tokenHash),
  index("idx_api_tokens_user").on(t.userId),
]);
