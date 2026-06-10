import { registerBackupContribution } from "@/modules/backup/registry";
import { hrBackupContribution } from "./hr.backup";

export { hrRoutes } from "./hr.routes";

registerBackupContribution(hrBackupContribution);
