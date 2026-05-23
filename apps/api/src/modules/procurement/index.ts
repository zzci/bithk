import { registerBackupContribution } from "@/modules/backup/registry";
import { procurementBackupContribution } from "./procurement.backup";

export { procurementRoutes } from "./procurement.routes";

registerBackupContribution(procurementBackupContribution);
