import type { FilePermissionHook } from "@/modules/file";
import { registerFilePermissionHook } from "@/modules/file";
import { getMemberCapabilities } from "./project.service";

/**
 * Permission hook for `owner_type='project_cover'`. The `owner_id` is the
 * internal project id (ULID).
 *
 * - `canRead`  → any project member (covers are shown on the detail header and
 *   list cards, which only members can reach). App admins bypass.
 * - `canDelete`→ the `project.manage` capability, matching who may edit project
 *   metadata. App admins bypass.
 */
export const projectCoverPermissionHook: FilePermissionHook = {
  async canRead(db, actor, ref) {
    if (actor.role === "admin")
      return true;
    return (await getMemberCapabilities(db, ref.ownerId, actor.id)) !== null;
  },
  async canDelete(db, actor, ref) {
    if (actor.role === "admin")
      return true;
    const caps = await getMemberCapabilities(db, ref.ownerId, actor.id);
    return caps?.has("project.manage") ?? false;
  },
};

/** Called once from the project module's index.ts at load time. */
export function registerProjectCoverPermissionHook(): void {
  registerFilePermissionHook("project_cover", projectCoverPermissionHook);
}
