import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { buildMemberLabelMap, memberLabel } from "./-member-helpers";

function member(overrides: Partial<ProjectMemberView> = {}): ProjectMemberView {
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

describe("memberLabel", () => {
  it("prefers an explicit displayName", () => {
    const m = member({ displayName: "Site Office", userId: "u1" });
    expect(memberLabel(m, new Map([["u1", "Alice"]]))).toBe("Site Office");
  });

  it("resolves a real member to its user name", () => {
    const m = member({ userId: "u1" });
    expect(memberLabel(m, new Map([["u1", "Alice"]]))).toBe("Alice");
  });

  it("falls back to the userId when the name is unknown", () => {
    const m = member({ userId: "u9" });
    expect(memberLabel(m, new Map())).toBe("u9");
  });

  it("falls back to the member id when there is neither name nor user", () => {
    const m = member({ id: "m42" });
    expect(memberLabel(m, new Map())).toBe("m42");
  });
});

describe("buildMemberLabelMap", () => {
  it("maps each member id to its resolved label", () => {
    const members = [
      member({ id: "m1", userId: "u1" }),
      member({ id: "m2", displayName: "Crew B" }),
    ];
    const map = buildMemberLabelMap(members, new Map([["u1", "Alice"]]));
    expect(map.get("m1")).toBe("Alice");
    expect(map.get("m2")).toBe("Crew B");
    expect(map.size).toBe(2);
  });
});
