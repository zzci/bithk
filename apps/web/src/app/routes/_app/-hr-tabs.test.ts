import { describe, expect, it } from "vitest";
import { activeHrTab, HR_TAB_TO, hrTabs } from "./-hr-tabs";

describe("hrTabs", () => {
  it("sorts the registry by order", () => {
    expect(hrTabs().map(t => t.value)).toEqual(["colleagues", "approvals", "payroll"]);
  });

  it("maps every tab to its route", () => {
    expect(HR_TAB_TO).toEqual({
      colleagues: "/hr/colleagues",
      approvals: "/hr/approvals",
      payroll: "/hr/payroll",
    });
  });
});

describe("activeHrTab", () => {
  it("resolves each sub-module path to its tab", () => {
    expect(activeHrTab("/hr/colleagues")).toBe("colleagues");
    expect(activeHrTab("/hr/approvals")).toBe("approvals");
    expect(activeHrTab("/hr/payroll")).toBe("payroll");
  });

  it("falls back to colleagues for index and unknown paths", () => {
    expect(activeHrTab("/hr")).toBe("colleagues");
    expect(activeHrTab("/hr/")).toBe("colleagues");
    expect(activeHrTab("/somewhere-else")).toBe("colleagues");
  });
});
