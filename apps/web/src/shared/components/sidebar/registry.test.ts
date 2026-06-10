import { describe, expect, it } from "vitest";
import { getNavItems } from "./registry";

describe("getNavItems", () => {
  it("returns admin entries sorted by order", () => {
    const items = getNavItems("admin");
    expect(items.map(i => i.key)).toEqual(["users", "policies", "audit", "cron", "platformSettings", "finance"]);
    expect(items.every(i => i.area === "admin")).toBe(true);
  });

  it("returns overview entries sorted by order", () => {
    const items = getNavItems("overview");
    expect(items.map(i => i.key)).toEqual(["overview", "documents", "drive", "projects", "ships", "contacts"]);
    expect(items.every(i => i.area === "overview")).toBe(true);
  });
});
