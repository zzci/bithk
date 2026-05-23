// Resolves the caller's effective capabilities within a project.
//
// The backend GET /projects/:id response carries the caller's capabilities
// (the full set for app admins). The UI gates affordances on these instead of
// on a fixed role name, since roles are user-defined.

import type { ProjectCapability, ProjectView } from "@/shared/lib/api/projects";
import { useMemo } from "react";
import { PROJECT_CAPABILITIES } from "@/shared/lib/api/projects";
import { useAuthStore } from "@/shared/stores/auth";

export interface ProjectCapabilityInfo {
  readonly has: (cap: ProjectCapability) => boolean;
  readonly canManageProject: boolean;
  readonly canManageMembers: boolean;
  readonly canManageRoles: boolean;
  readonly canManageContacts: boolean;
  readonly canManageCategories: boolean;
  readonly canViewProcurement: boolean;
  readonly canManageProcurement: boolean;
  /** Any management capability → the project settings dialog is reachable. */
  readonly canOpenSettings: boolean;
}

/**
 * Pure derivation of capability flags. Extracted from the hook so it can be
 * unit-tested without a render harness. App admins implicitly hold every
 * capability (mirrors the backend admin bypass) even if the payload lagged.
 */
export function computeCapabilities(
  caps: readonly ProjectCapability[] | undefined,
  isAppAdmin: boolean,
): ProjectCapabilityInfo {
  const set = new Set<ProjectCapability>(isAppAdmin ? PROJECT_CAPABILITIES : (caps ?? []));
  const has = (c: ProjectCapability): boolean => set.has(c);
  const canManageProject = has("project.manage");
  const canManageMembers = has("members.manage");
  const canManageRoles = has("roles.manage");
  const canManageContacts = has("contacts.manage");
  const canManageCategories = has("categories.manage");
  return {
    has,
    canManageProject,
    canManageMembers,
    canManageRoles,
    canManageContacts,
    canManageCategories,
    canViewProcurement: has("procurement.view"),
    canManageProcurement: has("procurement.manage"),
    canOpenSettings: canManageProject || canManageMembers || canManageRoles || canManageContacts || canManageCategories,
  };
}

export function useProjectCapabilities(project: Pick<ProjectView, "capabilities"> | undefined): ProjectCapabilityInfo {
  const isAppAdmin = useAuthStore(s => s.user?.role === "admin");
  return useMemo(() => computeCapabilities(project?.capabilities, isAppAdmin), [project?.capabilities, isAppAdmin]);
}
