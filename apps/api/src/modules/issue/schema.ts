import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { items } from "@/modules/item/schema";
import { projectMembers, projects } from "@/modules/project/schema";

// `issue` is a Tier-C sub-type of the `item` base. The base owns the
// universal columns (title / status / creator / version / soft-delete /
// timestamps) and the comments / attachments machinery; this table holds
// only the issue-specific business fields.
//
// What lives in `items` (base, queried via ItemService):
//   - id, short_id, type='issue', title, status, creator_id, version,
//     deleted_at, updated_at
//
// What does NOT live here on purpose:
//   - assignee_id → a policy tuple `(item, X, assignee, user, Y)`; the
//     policy engine is the single source of truth for "issues assigned
//     to me" lookups.
//   - comments → `item_comments`.
//   - attachments → `file_references` with owner_type='item_attachment',
//     owner_id=<items.id>.
export const issueDetails = sqliteTable("issue_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  description: text("description"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  dueDate: text("due_date"),
  // NULL → personal issue (legacy behavior, user-tuple assignment). Set →
  // project issue (work order): the assignment target is `project_members.id`.
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  // Project-issue assignee. For INTERNAL members the legacy `item#assignee@user`
  // tuple is still written alongside this so "my issues" keeps working; for
  // EXTERNAL members (no user account) only this column is set.
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
}, t => [
  index("issue_project_idx").on(t.projectId),
]);
