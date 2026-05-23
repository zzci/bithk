import { registerBackupContribution } from "@/modules/backup/registry";
import { driveBackupContribution } from "./drive.backup";
import "./drive.file-permission";
// Side-effect import: registers the drive share adapter with the share module.
import "./drive.share-adapter";

export { driveAccess } from "./drive.permission";
export { driveRoutes } from "./drive.routes";

registerBackupContribution(driveBackupContribution);
