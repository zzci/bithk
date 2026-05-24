import { registerBackupContribution } from "@/modules/backup/registry";
import { shipBackupContribution } from "./ship.backup";

export { shipRoutes } from "./ship.routes";

registerBackupContribution(shipBackupContribution);
