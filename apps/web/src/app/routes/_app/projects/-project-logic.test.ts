import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { buildMemberLabelMap, memberLabel } from "./-member-helpers";
import { computeCapabilities } from "./-use-project-role";

function member(overrides: Partial<ProjectMemberView>): ProjectMemberView {
  return {
    id: "m1",
    userId: null,
    displayName: null,
    roleId: "r1",
    title: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeCapabilities", () => {
  it("grants nothing when capabilities are undefined and not an admin", () => {
    const c = computeCapabilities(undefined, false);
    expect(c.canManageProject).toBe(false);
    expect(c.canViewProcurement).toBe(false);
    expect(c.canOpenSettings).toBe(false);
  });

  it("derives flags from the capability list", () => {
    const c = computeCapabilities(["procurement.view", "members.manage"], false);
    expect(c.canViewProcurement).toBe(true);
    expect(c.canManageMembers).toBe(true);
    expect(c.canManageProcurement).toBe(false);
    expect(c.canOpenSettings).toBe(true); // members.manage is a management capability
  });

  it("treats an app admin as holding every capability", () => {
    const c = computeCapabilities(undefined, true);
    expect(c.canManageProject).toBe(true);
    expect(c.canManageRoles).toBe(true);
    expect(c.canViewProcurement).toBe(true);
    expect(c.canManageProcurement).toBe(true);
    expect(c.canOpenSettings).toBe(true);
  });

  it("a plain member (empty capabilities) can open neither settings nor procurement", () => {
    const c = computeCapabilities([], false);
    expect(c.canOpenSettings).toBe(false);
    expect(c.canViewProcurement).toBe(false);
  });
});

describe("memberLabel / buildMemberLabelMap", () => {
  const names = new Map([["u1", "Alice"]]);

  it("prefers the explicit displayName", () => {
    expect(memberLabel(member({ displayName: "Acme Corp", userId: "u1" }), names)).toBe("Acme Corp");
  });

  it("resolves a real member to the user name", () => {
    expect(memberLabel(member({ userId: "u1" }), names)).toBe("Alice");
  });

  it("falls back to the user id when the name is unknown", () => {
    expect(memberLabel(member({ userId: "u2" }), names)).toBe("u2");
  });

  it("falls back to the member id when there is no name or user", () => {
    expect(memberLabel(member({ id: "m9", userId: null, displayName: null }), names)).toBe("m9");
  });

  it("builds a label map keyed by member id", () => {
    const map = buildMemberLabelMap(
      [member({ id: "a", displayName: "Ext" }), member({ id: "b", userId: "u1" })],
      names,
    );
    expect(map.get("a")).toBe("Ext");
    expect(map.get("b")).toBe("Alice");
    expect(map.size).toBe(2);
  });
});
