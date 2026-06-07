import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { computeCapabilities } from "@/shared/hooks/use-project-capabilities";
import { buildMemberLabelMap, memberLabel } from "./-member-helpers";

function member(overrides: Partial<ProjectMemberView>): ProjectMemberView {
  return {
    id: "m1",
    userId: "u1",
    name: "Alice",
    isVirtual: false,
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
  it("returns the member's resolved name", () => {
    expect(memberLabel(member({ name: "Acme Corp" }))).toBe("Acme Corp");
  });

  it("returns the name for a virtual member too", () => {
    expect(memberLabel(member({ name: "Crew B", isVirtual: true }))).toBe("Crew B");
  });

  it("builds a label map keyed by member id", () => {
    const map = buildMemberLabelMap(
      [member({ id: "a", name: "Ext", isVirtual: true }), member({ id: "b", name: "Alice" })],
    );
    expect(map.get("a")).toBe("Ext");
    expect(map.get("b")).toBe("Alice");
    expect(map.size).toBe(2);
  });
});
