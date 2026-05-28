import { registerBackupContribution } from "@/modules/backup/registry";
import { tagBackupContribution } from "./tag.backup";

registerBackupContribution(tagBackupContribution);

export { registerTagSource } from "./tag.registry";
export { tagRoutes } from "./tag.routes";
