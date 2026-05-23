import type { ProjectCapability } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { PROJECT_CAPABILITIES } from "@/shared/lib/api/projects";
import { computeCapabilities } from "./-use-project-role";

describe("computeCapabilities", () => {
  it("treats an app admin as holding every capability even with an empty payload", () => {
    const caps = computeCapabilities(undefined, true);
    for (const c of PROJECT_CAPABILITIES)
      expect(caps.has(c)).toBe(true);
    expect(caps.canManageProject).toBe(true);
    expect(caps.canManageMembers).toBe(true);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canManageContacts).toBe(true);
    expect(caps.canManageCategories).toBe(true);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canManageProcurement).toBe(true);
    expect(caps.canOpenSettings).toBe(true);
  });

  it("derives flags from the payload for a non-admin member", () => {
    const granted: readonly ProjectCapability[] = ["contacts.manage", "procurement.view"];
    const caps = computeCapabilities(granted, false);
    expect(caps.canManageContacts).toBe(true);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canManageProject).toBe(false);
    expect(caps.canManageMembers).toBe(false);
    expect(caps.canManageRoles).toBe(false);
    expect(caps.canManageCategories).toBe(false);
    expect(caps.canManageProcurement).toBe(false);
  });

  it("opens settings when any management capability is present", () => {
    expect(computeCapabilities(["members.manage"], false).canOpenSettings).toBe(true);
    expect(computeCapabilities(["roles.manage"], false).canOpenSettings).toBe(true);
    expect(computeCapabilities(["categories.manage"], false).canOpenSettings).toBe(true);
  });

  it("keeps settings closed for a view-only member", () => {
    const caps = computeCapabilities(["procurement.view"], false);
    expect(caps.canOpenSettings).toBe(false);
  });

  it("treats a missing payload as no capabilities for a non-admin", () => {
    const caps = computeCapabilities(undefined, false);
    expect(caps.canOpenSettings).toBe(false);
    expect(caps.has("project.manage")).toBe(false);
  });
});
