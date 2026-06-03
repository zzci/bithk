import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { buildMemberLabelMap, memberLabel } from "./-member-helpers";

function member(overrides: Partial<ProjectMemberView> = {}): ProjectMemberView {
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

describe("memberLabel", () => {
  it("returns the member's resolved name", () => {
    const m = member({ name: "Site Office" });
    expect(memberLabel(m)).toBe("Site Office");
  });

  it("returns the name for a virtual member too", () => {
    const m = member({ name: "Crew B", isVirtual: true });
    expect(memberLabel(m)).toBe("Crew B");
  });
});

describe("buildMemberLabelMap", () => {
  it("maps each member id to its name", () => {
    const members = [
      member({ id: "m1", name: "Alice" }),
      member({ id: "m2", name: "Crew B", isVirtual: true }),
    ];
    const map = buildMemberLabelMap(members);
    expect(map.get("m1")).toBe("Alice");
    expect(map.get("m2")).toBe("Crew B");
    expect(map.size).toBe(2);
  });
});
