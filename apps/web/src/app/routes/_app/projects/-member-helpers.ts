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
 * A member's display label. Every member is a unified users row, so the name
 * is resolved server-side onto `member.name`. The `userNames` map is accepted
 * (and ignored) only so existing call sites that pass it keep compiling.
 */
export function memberLabel(
  member: ProjectMemberView,
  _userNames?: ReadonlyMap<string, string>,
): string {
  return member.name;
}

export function buildMemberLabelMap(
  members: readonly ProjectMemberView[],
  _userNames?: ReadonlyMap<string, string>,
): Map<string, string> {
  return new Map(members.map(m => [m.id, memberLabel(m)]));
}
