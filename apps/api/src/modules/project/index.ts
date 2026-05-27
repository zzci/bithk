import { registerBackupContribution } from "@/modules/backup/registry";
import { projectBackupContribution } from "./project.backup";
import { registerProjectCoverPermissionHook } from "./project.cover.permission";

export { projectRoutes } from "./project.routes";

registerBackupContribution(projectBackupContribution);
registerProjectCoverPermissionHook();
