import type { FilePermissionHook } from "@/modules/file";
import { registerFilePermissionHook } from "@/modules/file";
import { getShipById, userCanManageShip } from "./ship.service";

/**
 * Permission hook for `owner_type='ship_cover'`. The `owner_id` is the internal
 * ship id (ULID).
 *
 * - `canRead`  → any authenticated user. Covers are read-only branding; the file
 *   route already enforces authentication before this hook runs, so membership
 *   in the ship's base project is not required to view.
 * - `canDelete`→ anchored on the ship's base project `manage` rule (the same
 *   gate the ship write routes enforce). App admins bypass.
 */
export const shipCoverPermissionHook: FilePermissionHook = {
  async canRead() {
    return true;
  },
  async canDelete(db, actor, ref) {
    const ship = await getShipById(db, ref.ownerId);
    if (!ship)
      return false;
    return userCanManageShip(db, ship, actor.id, actor.role === "admin");
  },
};

/** Called once from the ship module's index.ts at load time. */
export function registerShipCoverPermissionHook(): void {
  registerFilePermissionHook("ship_cover", shipCoverPermissionHook);
}
