import { registerBackupContribution } from "@/modules/backup/registry";
import { financeBackupContribution } from "./finance.backup";

export { financeRoutes } from "./finance.routes";

registerBackupContribution(financeBackupContribution);
