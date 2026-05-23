import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { buildMemberLabelMap, memberLabel } from "./-member-helpers";
import { computeProjectRole } from "./-use-project-role";

function member(overrides: Partial<ProjectMemberView>): ProjectMemberView {
  return {
    id: "m1",
    memberType: "internal",
    role: "member",
    userId: null,
    displayName: null,
    externalRef: null,
    supplierInfo: null,
    canViewProcurement: false,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeProjectRole", () => {
  it("returns the empty role when members are undefined", () => {
    const r = computeProjectRole(undefined, "u1", false);
    expect(r.member).toBeNull();
    expect(r.role).toBeNull();
    expect(r.isPm).toBe(false);
    expect(r.canViewProcurement).toBe(false);
  });

  it("returns the empty role when the user is not a member", () => {
    const r = computeProjectRole([member({ id: "m1", userId: "other" })], "u1", false);
    expect(r.member).toBeNull();
    expect(r.role).toBeNull();
  });

  it("never matches an external member with a null userId against a null caller", () => {
    const r = computeProjectRole([member({ userId: null })], null, false);
    expect(r.member).toBeNull();
  });

  it("flags a pm and grants procurement implicitly", () => {
    const r = computeProjectRole([member({ id: "pm1", userId: "u1", role: "pm" })], "u1", false);
    expect(r.isPm).toBe(true);
    expect(r.role).toBe("pm");
    expect(r.canViewProcurement).toBe(true);
  });

  it("denies procurement to a plain member without the grant", () => {
    const r = computeProjectRole([member({ userId: "u1", role: "member", canViewProcurement: false })], "u1", false);
    expect(r.isPm).toBe(false);
    expect(r.canViewProcurement).toBe(false);
  });

  it("grants procurement to a member with the explicit flag", () => {
    const r = computeProjectRole([member({ userId: "u1", role: "member", canViewProcurement: true })], "u1", true);
    expect(r.canViewProcurement).toBe(true);
  });

  it("treats an app admin as pm even without a membership row", () => {
    const r = computeProjectRole([member({ userId: "other", role: "pm" })], "admin1", true);
    expect(r.member).toBeNull();
    expect(r.role).toBeNull();
    expect(r.isPm).toBe(true);
    expect(r.canViewProcurement).toBe(true);
  });
});

describe("memberLabel / buildMemberLabelMap", () => {
  const names = new Map([["u1", "Alice"]]);

  it("prefers the explicit displayName", () => {
    expect(memberLabel(member({ displayName: "Acme Corp", userId: "u1" }), names)).toBe("Acme Corp");
  });

  it("resolves an internal member to the user name", () => {
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
