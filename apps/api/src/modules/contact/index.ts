import { registerBackupContribution } from "@/modules/backup/registry";
import { registerContactAvatarPermissionHook } from "./contact-avatar.permission";
import { contactBackupContribution } from "./contact.backup";

export {
  assertContactCapability,
  canSeeConfidentialFields,
  contactAccess,
  resolveContactCapabilities,
} from "./contact.permission";
export type { ContactAccessActor, ContactCapability } from "./contact.permission";
export { contactRoutes } from "./contact.routes";
export * as contactService from "./contact.service";

registerBackupContribution(contactBackupContribution);
registerContactAvatarPermissionHook();
