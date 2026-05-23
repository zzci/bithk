import { registerBackupContribution } from "@/modules/backup/registry";
import { shareBackupContribution } from "./share.backup";

export type { PublicShareEntry, PublicShareListing, ShareAdapter, ShareContent, ShareGateRow, ShareResolved } from "./adapter";
export { registerShareAdapter } from "./adapter";
export { sharePublicRoutes } from "./share.public.routes";
export { shareRoutes } from "./share.routes";
export { deleteSharesForResource } from "./share.service";

registerBackupContribution(shareBackupContribution);
