import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { items } from "@/modules/item/schema";
import { projectMembers, projects } from "@/modules/project/schema";

// Generic issue references (additive, separate table). Re-exported here so the
// aggregated `db/schema.ts` picks it up via its single `export *` per module.
export * from "./references.schema";

// `issue` is a Tier-C sub-type of the `item` base. The base owns the
// universal columns (title / status / creator / version / soft-delete /
// timestamps) and the comments / attachments machinery; this table holds
// only the issue-specific business fields.
//
// Every issue is a project work order — it always belongs to a project and is
// assigned to a `project_members.id`. There is no global / personal issue.
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
  // The owning project. Always set — an issue cannot exist outside a project.
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Project-issue assignee. For INTERNAL members the `item#assignee@user`
  // tuple is written alongside this so assignee-based lookups keep working;
  // for EXTERNAL members (no user account) only this column is set.
  assigneeMemberId: text("assignee_member_id").references(() => projectMembers.id, { onDelete: "set null" }),
}, t => [
  index("issue_project_idx").on(t.projectId),
]);
