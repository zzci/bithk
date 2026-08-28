import { registerBackupContribution } from "@/modules/backup/registry";
import { registerProjectSection } from "@/modules/project/section.registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { issueBackupContribution } from "./issue.backup";
import { hasProjectIssues, searchIssues } from "./issue.service";

export { issueRoutes } from "./issue.routes";

registerBackupContribution(issueBackupContribution);

// The `issues` section (PLAN-108 §3), registered from its owning module's
// barrel as an import-time side effect (ADR-009). Registry entry only: the
// issue module already owns its tables, routes (`/projects/:projectId/issues*`)
// and capabilities, so folding it into the section model costs one definition
// plus the `requireSection` gate on those routes. Nothing to provision — a new
// project simply starts with no issues.
registerProjectSection({
  key: "issues",
  capabilities: ["issue.view", "issue.comment", "issue.manage"],
  hasData: hasProjectIssues,
});

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
