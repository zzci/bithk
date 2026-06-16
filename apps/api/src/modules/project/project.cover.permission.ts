import type { FilePermissionHook } from "@/modules/file";
import { registerFilePermissionHook } from "@/modules/file";
import { getMemberCapabilities, PROJECT_DEFAULT_COVER_OWNER_TYPE } from "./project.service";

/**
 * Permission hook for `owner_type='project_cover'`. The `owner_id` is the
 * internal project id (ULID).
 *
 * - `canRead`  → any authenticated user. Covers are read-only branding shown on
 *   list cards and detail headers; the file route already enforces
 *   authentication before this hook runs, so membership is not required to view.
 * - `canDelete`→ the `project.manage` capability, matching who may edit project
 *   metadata. App admins bypass.
 */
export const projectCoverPermissionHook: FilePermissionHook = {
  async canRead() {
    return true;
  },
  async canDelete(db, actor, ref) {
    if (actor.role === "admin")
      return true;
    const caps = await getMemberCapabilities(db, ref.ownerId, actor.id);
    return caps?.has("project.manage") ?? false;
  },
};

/**
 * Permission hook for `owner_type='project_cover_default'` — the admin-managed
 * global default cover applied to new projects that have no explicit cover.
 *
 * - `canRead`  → any authenticated user (same read-only branding rationale as
 *   `project_cover`).
 * - `canDelete`→ app admins only. The default cover is managed exclusively
 *   through admin-only routes, so admin-only delete is the conservative gate.
 */
export const projectDefaultCoverPermissionHook: FilePermissionHook = {
  async canRead() {
    return true;
  },
  async canDelete(_db, actor) {
    return actor.role === "admin";
  },
};

/** Called once from the project module's index.ts at load time. */
export function registerProjectCoverPermissionHook(): void {
  registerFilePermissionHook("project_cover", projectCoverPermissionHook);
  registerFilePermissionHook(PROJECT_DEFAULT_COVER_OWNER_TYPE, projectDefaultCoverPermissionHook);
}
