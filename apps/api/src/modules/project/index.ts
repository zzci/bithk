import { registerBackupContribution } from "@/modules/backup/registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { projectBackupContribution } from "./project.backup";
import { registerProjectCoverPermissionHook } from "./project.cover.permission";
import { listProjects } from "./project.service";

export { projectRoutes } from "./project.routes";

registerBackupContribution(projectBackupContribution);
registerProjectCoverPermissionHook();

registerSearchSource({
  key: "projects",
  module: "projects",
  search: async ({ db, userId, isAdmin, limit }, q) => {
    const result = await listProjects(db, { q, limit, memberUserId: isAdmin ? undefined : userId });
    return result.data.map(p => ({ type: "project" as const, id: p.id, title: p.name, subtitle: p.code }));
  },
});
