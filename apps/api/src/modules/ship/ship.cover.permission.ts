import type { FilePermissionHook } from "@/modules/file";
import { registerFilePermissionHook } from "@/modules/file";
import { getShipById, userCanManageShip, userCanReadShip } from "./ship.service";

/**
 * Permission hook for `owner_type='ship_cover'`. The `owner_id` is the internal
 * ship id (ULID). Read / manage are anchored on the ship's base project (the
 * same rule the ship routes enforce). App admins bypass.
 */
export const shipCoverPermissionHook: FilePermissionHook = {
  async canRead(db, actor, ref) {
    const ship = await getShipById(db, ref.ownerId);
    if (!ship)
      return false;
    return userCanReadShip(db, ship, actor.id, actor.role === "admin");
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
