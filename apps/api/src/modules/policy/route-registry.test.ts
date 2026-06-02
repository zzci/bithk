import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { contactAccess } from "@/modules/contact/contact.permission";
import {
  __resetRouteBindingsForTests,
  getAllRouteBindings,
  getRouteBindingsForResource,
  registerRouteBinding,
} from "./route-registry";

// The binding table is a process-global singleton populated at import time by
// every resource module. Snapshot whatever is already registered and restore
// it after this suite so the reset/re-register churn below leaves no trace for
// other test files (mirrors the loadNamespaces() restore in policy.service).
const initialBindings = getAllRouteBindings();

afterAll(() => {
  __resetRouteBindingsForTests();
  for (const b of initialBindings)
    registerRouteBinding(b);
});

describe("route-registry table mechanics", () => {
  beforeEach(() => {
    __resetRouteBindingsForTests();
  });

  it("registers bindings and returns them all", () => {
    registerRouteBinding({ resourceName: "a", method: "GET", path: "/a/:id", action: "a:read" });
    registerRouteBinding({ resourceName: "b", method: "POST", path: "/b", action: "b:create" });
    expect(getAllRouteBindings()).toEqual([
      { resourceName: "a", method: "GET", path: "/a/:id", action: "a:read" },
      { resourceName: "b", method: "POST", path: "/b", action: "b:create" },
    ]);
  });

  it("filters bindings by resource name", () => {
    registerRouteBinding({ resourceName: "a", method: "GET", path: "/a/:id", action: "a:read" });
    registerRouteBinding({ resourceName: "a", method: "DELETE", path: "/a/:id", action: "a:delete" });
    registerRouteBinding({ resourceName: "b", method: "POST", path: "/b", action: "b:create" });

    const forA = getRouteBindingsForResource("a");
    expect(forA).toHaveLength(2);
    expect(forA.every(b => b.resourceName === "a")).toBe(true);
    expect(getRouteBindingsForResource("missing")).toEqual([]);
  });

  it("returns a defensive copy, not the backing array", () => {
    registerRouteBinding({ resourceName: "a", method: "GET", path: "/a", action: "a:read" });
    expect(getAllRouteBindings()).not.toBe(getAllRouteBindings());
  });

  it("clears every binding on reset", () => {
    registerRouteBinding({ resourceName: "a", method: "GET", path: "/a", action: "a:read" });
    __resetRouteBindingsForTests();
    expect(getAllRouteBindings()).toEqual([]);
  });
});

describe("real resource bindings resolve to expected actions", () => {
  beforeEach(() => {
    // Re-register from the resource's own route table so the assertions below
    // pin the real (method, path) → action mapping and fail on a mis-binding,
    // independent of cross-file registration order.
    __resetRouteBindingsForTests();
    for (const r of contactAccess.definition.routes ?? [])
      registerRouteBinding({ resourceName: contactAccess.name, method: r.method, path: r.path, action: r.action });
  });

  it("maps each contact route+method to its declared action", () => {
    const bindings = getRouteBindingsForResource("contact");
    const actionFor = (method: string, path: string): string | undefined =>
      bindings.find(b => b.method === method && b.path === path)?.action;

    expect(actionFor("GET", "/contacts/:id")).toBe("contact:read");
    expect(actionFor("PATCH", "/contacts/:id")).toBe("contact:update");
    expect(actionFor("DELETE", "/contacts/:id")).toBe("contact:delete");
    expect(actionFor("POST", "/contacts/:id/grant")).toBe("contact:share");
    expect(actionFor("POST", "/contacts/:id/revoke")).toBe("contact:share");
  });
});
