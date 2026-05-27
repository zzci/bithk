import { registerBackupContribution } from "@/modules/backup/registry";
import { shipBackupContribution } from "./ship.backup";
import { registerShipCoverPermissionHook } from "./ship.cover.permission";

export { shipRoutes } from "./ship.routes";

registerBackupContribution(shipBackupContribution);
registerShipCoverPermissionHook();
