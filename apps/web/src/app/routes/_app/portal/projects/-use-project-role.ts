// Resolves the caller's role within a project from the members list.
//
// The backend GET /projects/:id returns no caller-role, so the UI derives it
// by matching the current user id against the member rows. App admins are NOT
// auto-members; gating is purely on the membership row.

import type { ProjectMemberView, ProjectRole } from "@/shared/lib/api/projects";
import { useMemo } from "react";
import { useAuthStore } from "@/shared/stores/auth";

export interface ProjectRoleInfo {
  /** The caller's membership row, or null when not a member. */
  readonly member: ProjectMemberView | null;
  /** The caller's project role, or null when not a member. */
  readonly role: ProjectRole | null;
  readonly isPm: boolean;
  /** pm OR explicit canViewProcurement grant. */
  readonly canViewProcurement: boolean;
}

/**
 * Pure derivation of the caller's project role from the members list. Extracted
 * from the hook so it can be unit-tested without a render harness.
 *
 * App admins are treated as pm-equivalent even without a membership row: they
 * can view and manage every project (mirrors the backend admin bypass), which
 * prevents a project from being locked out when its last pm member is removed.
 */
export function computeProjectRole(
  members: readonly ProjectMemberView[] | undefined,
  userId: string | null,
  isAppAdmin: boolean,
): ProjectRoleInfo {
  const member = members?.find(m => m.userId !== null && m.userId === userId) ?? null;
  const role = member?.role ?? null;
  const isPm = role === "pm" || isAppAdmin;
  return {
    member,
    role,
    isPm,
    canViewProcurement: isPm || (member?.canViewProcurement ?? false),
  };
}

export function useProjectRole(members: readonly ProjectMemberView[] | undefined): ProjectRoleInfo {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const isAppAdmin = useAuthStore(s => s.user?.role === "admin");
  return useMemo(() => computeProjectRole(members, userId, isAppAdmin), [members, userId, isAppAdmin]);
}
