// Shared helpers for rendering project members in pickers and tables.

import type { ProjectMemberView, ProjectRoleView } from "@/shared/lib/api/projects";

/** Resolve the display label for a system role based on its `kind` field. */
export function systemRoleLabel(role: ProjectRoleView, ownerLabel: string, guestLabel: string): string {
  if (role.kind === "guest")
    return guestLabel;
  // kind==="owner" or legacy system roles with no kind
  return ownerLabel;
}

/**
 * Build a lookup from member id to a human label. Internal members fall back
 * to their resolved user name via `userNames`; external members use their
 * displayName. The member id is the last-resort fallback.
 */
export function memberLabel(
  member: ProjectMemberView,
  userNames: ReadonlyMap<string, string>,
): string {
  if (member.displayName)
    return member.displayName;
  if (member.userId)
    return userNames.get(member.userId) ?? member.userId;
  return member.id;
}

export function buildMemberLabelMap(
  members: readonly ProjectMemberView[],
  userNames: ReadonlyMap<string, string>,
): Map<string, string> {
  return new Map(members.map(m => [m.id, memberLabel(m, userNames)]));
}
