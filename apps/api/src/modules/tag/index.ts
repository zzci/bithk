import { registerBackupContribution } from "@/modules/backup/registry";
import { tagBackupContribution } from "./tag.backup";

registerBackupContribution(tagBackupContribution);
