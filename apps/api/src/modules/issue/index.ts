import { registerBackupContribution } from "@/modules/backup/registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { issueBackupContribution } from "./issue.backup";
import { searchIssues } from "./issue.service";

export { issueRoutes } from "./issue.routes";

registerBackupContribution(issueBackupContribution);

registerSearchSource({
  key: "issues",
  // Issues live under the `projects` module — same registry prefix mapping
  // as the route-level module gate (PLAN-076).
  module: "projects",
  search: async ({ db, userId, isAdmin, limit }, q) => {
    const issues = await searchIssues(db, { userId, isAdmin, q, limit });
    return issues.map(i => ({ type: "issue" as const, id: i.id, title: i.title, subtitle: i.status, projectId: i.projectId }));
  },
});
