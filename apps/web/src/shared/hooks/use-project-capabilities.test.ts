import type { ProjectCapability } from "@/shared/lib/api/projects";
import { describe, expect, it } from "vitest";
import { PROJECT_CAPABILITIES } from "@/shared/lib/api/projects";
import { computeCapabilities } from "./use-project-capabilities";

describe("computeCapabilities", () => {
  it("treats an app admin as holding every capability even with an empty payload", () => {
    const caps = computeCapabilities(undefined, true);
    for (const c of PROJECT_CAPABILITIES)
      expect(caps.has(c)).toBe(true);
    expect(caps.canViewIssues).toBe(true);
    expect(caps.canCommentIssues).toBe(true);
    expect(caps.canManageIssues).toBe(true);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canCommentProcurement).toBe(true);
    expect(caps.canManageProcurement).toBe(true);
    expect(caps.canViewFiles).toBe(true);
    expect(caps.canManageFiles).toBe(true);
    expect(caps.canManageProject).toBe(true);
    expect(caps.canManageMembers).toBe(true);
    expect(caps.canManageRoles).toBe(true);
    expect(caps.canManageCategories).toBe(true);
    expect(caps.canOpenSettings).toBe(true);
  });

  it("derives flags from the payload for a non-admin member", () => {
    const granted: readonly ProjectCapability[] = ["categories.manage", "procurement.view"];
    const caps = computeCapabilities(granted, false);
    expect(caps.canManageCategories).toBe(true);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canManageProject).toBe(false);
    expect(caps.canManageMembers).toBe(false);
    expect(caps.canManageRoles).toBe(false);
    expect(caps.canManageProcurement).toBe(false);
    expect(caps.canViewIssues).toBe(false);
    expect(caps.canCommentIssues).toBe(false);
    expect(caps.canManageIssues).toBe(false);
    expect(caps.canViewFiles).toBe(false);
    expect(caps.canManageFiles).toBe(false);
  });

  it("derives per-module issue flags correctly", () => {
    const granted: readonly ProjectCapability[] = ["issue.view", "issue.comment"];
    const caps = computeCapabilities(granted, false);
    expect(caps.canViewIssues).toBe(true);
    expect(caps.canCommentIssues).toBe(true);
    expect(caps.canManageIssues).toBe(false);
  });

  it("derives per-module procurement flags correctly", () => {
    const granted: readonly ProjectCapability[] = ["procurement.view", "procurement.comment", "procurement.manage"];
    const caps = computeCapabilities(granted, false);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canCommentProcurement).toBe(true);
    expect(caps.canManageProcurement).toBe(true);
  });

  it("derives per-module files flags correctly", () => {
    const granted: readonly ProjectCapability[] = ["files.view", "files.manage"];
    const caps = computeCapabilities(granted, false);
    expect(caps.canViewFiles).toBe(true);
    expect(caps.canManageFiles).toBe(true);
  });

  it("files.view without files.manage allows read but not write", () => {
    const caps = computeCapabilities(["files.view"], false);
    expect(caps.canViewFiles).toBe(true);
    expect(caps.canManageFiles).toBe(false);
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
    expect(caps.canViewIssues).toBe(false);
    expect(caps.canViewFiles).toBe(false);
  });

  it("writer preset: issue+procurement+files manage without admin caps keeps settings closed", () => {
    const granted: readonly ProjectCapability[] = [
      "issue.view",
      "issue.comment",
      "issue.manage",
      "procurement.view",
      "procurement.comment",
      "procurement.manage",
      "files.view",
      "files.manage",
      "categories.manage",
    ];
    const caps = computeCapabilities(granted, false);
    expect(caps.canViewIssues).toBe(true);
    expect(caps.canManageIssues).toBe(true);
    expect(caps.canViewProcurement).toBe(true);
    expect(caps.canManageProcurement).toBe(true);
    expect(caps.canViewFiles).toBe(true);
    expect(caps.canManageFiles).toBe(true);
    // categories.manage → opens settings
    expect(caps.canOpenSettings).toBe(true);
    // no admin-tier caps
    expect(caps.canManageProject).toBe(false);
    expect(caps.canManageMembers).toBe(false);
    expect(caps.canManageRoles).toBe(false);
  });
});
