import type { FilePermissionHook } from "@/modules/file";
import { eq } from "drizzle-orm";
import { registerFilePermissionHook } from "@/modules/file";
import { resolveContactCapabilities } from "./contact.permission";
import { CONTACT_AVATAR_OWNER_TYPE } from "./contact.service";
import { contacts } from "./schema";

/**
 * Permission hook for `owner_type='contact_avatar'`. The `owner_id` is the
 * contact id (nanoid). Avatar read/manage follows the contact's own
 * read/update capability:
 *
 * - `canRead`  → anyone who can read the contact (owner, explicit viewer,
 *   public visibility, admin).
 * - `canDelete`→ anyone who can update the contact (owner, explicit owner
 *   grant, admin).
 */
export const contactAvatarPermissionHook: FilePermissionHook = {
  async canRead(db, actor, ref) {
    const contact = await db
      .select({ id: contacts.id, ownerId: contacts.ownerId, visibility: contacts.visibility, confidential: contacts.confidential })
      .from(contacts)
      .where(eq(contacts.id, ref.ownerId))
      .get();
    if (!contact)
      return false;
    return (await resolveContactCapabilities(db, contact, actor)).has("read");
  },
  async canDelete(db, actor, ref) {
    const contact = await db
      .select({ id: contacts.id, ownerId: contacts.ownerId, visibility: contacts.visibility, confidential: contacts.confidential })
      .from(contacts)
      .where(eq(contacts.id, ref.ownerId))
      .get();
    if (!contact)
      return false;
    return (await resolveContactCapabilities(db, contact, actor)).has("update");
  },
};

/** Called once from the contact module's index.ts at load time. */
export function registerContactAvatarPermissionHook(): void {
  registerFilePermissionHook(CONTACT_AVATAR_OWNER_TYPE, contactAvatarPermissionHook);
}
