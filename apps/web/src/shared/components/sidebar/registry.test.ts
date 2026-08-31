import { describe, expect, it } from "vitest";
import { getNavItems } from "./registry";

describe("getNavItems", () => {
  it("returns admin entries sorted by order", () => {
    const items = getNavItems("admin");
    expect(items.map(i => i.key)).toEqual(["users", "policies", "audit", "cron", "platformSettings"]);
    expect(items.every(i => i.area === "admin")).toBe(true);
  });

  it("returns overview entries sorted by order", () => {
    const items = getNavItems("overview");
    expect(items.map(i => i.key)).toEqual(["overview", "documents", "drive", "projects", "contacts", "hr"]);
    expect(items.every(i => i.area === "overview")).toBe(true);
  });

  it("declares a module key on every gateable main-area entry", () => {
    const byKey = Object.fromEntries(getNavItems("overview").map(i => [i.key, i.module]));
    expect(byKey).toEqual({
      overview: undefined,
      documents: "documents",
      drive: "drive",
      projects: "projects",
      contacts: "contacts",
      hr: "hr",
    });
  });
});
