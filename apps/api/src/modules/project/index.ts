import { registerBackupContribution } from "@/modules/backup/registry";
import { projectBackupContribution } from "./project.backup";

export { projectRoutes } from "./project.routes";

registerBackupContribution(projectBackupContribution);
