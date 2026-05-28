import { registerBackupContribution } from "@/modules/backup/registry";
import { registerItemAttachmentPermissionHook } from "./attachment.permission";
import { registerItemCommentAttachmentPermissionHook } from "./comment-attachment.permission";
import { itemBackupContribution } from "./item.backup";

// The `item` module is a server-side primitive consumed by sub-type modules
// (issue, document, …); sub-types own their `/api/<type>` routes and call
// ItemService internally. The one HTTP surface it owns is the cross-type
// project Pin area, which aggregates pinned issues + procurements.
export { itemRoutes } from "./item.routes";

registerBackupContribution(itemBackupContribution);

// Permission hooks for file references that the file module's routes will
// consult. Both resolve back to the parent item and ask the policy engine.
registerItemAttachmentPermissionHook();
registerItemCommentAttachmentPermissionHook();
