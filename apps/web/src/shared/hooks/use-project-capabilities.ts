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
  // ── Issue module ──
  readonly canViewIssues: boolean;
  readonly canCommentIssues: boolean;
  readonly canManageIssues: boolean;
  // ── Procurement module ──
  readonly canViewProcurement: boolean;
  readonly canCommentProcurement: boolean;
  readonly canManageProcurement: boolean;
  // ── Files module ──
  readonly canViewFiles: boolean;
  readonly canManageFiles: boolean;
  // ── Project admin ──
  readonly canManageProject: boolean;
  readonly canManageMembers: boolean;
  readonly canManageRoles: boolean;
  readonly canManageCategories: boolean;
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
  const canManageCategories = has("categories.manage");
  return {
    has,
    canViewIssues: has("issue.view"),
    canCommentIssues: has("issue.comment"),
    canManageIssues: has("issue.manage"),
    canViewProcurement: has("procurement.view"),
    canCommentProcurement: has("procurement.comment"),
    canManageProcurement: has("procurement.manage"),
    canViewFiles: has("files.view"),
    canManageFiles: has("files.manage"),
    canManageProject,
    canManageMembers,
    canManageRoles,
    canManageCategories,
    canOpenSettings: canManageProject || canManageMembers || canManageRoles || canManageCategories,
  };
}

export function useProjectCapabilities(project: Pick<ProjectView, "capabilities"> | undefined): ProjectCapabilityInfo {
  const isAppAdmin = useAuthStore(s => s.user?.role === "admin");
  return useMemo(() => computeCapabilities(project?.capabilities, isAppAdmin), [project?.capabilities, isAppAdmin]);
}
