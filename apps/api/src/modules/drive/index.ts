import { registerBackupContribution } from "@/modules/backup/registry";
import { driveBackupContribution } from "./drive.backup";
import "./drive.file-permission";

export { driveAccess } from "./drive.permission";
export { drivePublicRoutes } from "./drive.public.routes";
export { driveRoutes } from "./drive.routes";

registerBackupContribution(driveBackupContribution);
