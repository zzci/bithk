import type { TokenScopeMap } from "./scope";
import { describe, expect, test } from "bun:test";
import { protectedRoutes } from "@/routes/protected";
import { TOKEN_MODULE_KEYS, TOKEN_MODULES, tokenModuleForPath } from "@/shared/module-manifest";
import {
  isValidScopeInput,
  levelForMethod,
  parseScopes,
  scopeSatisfies,
} from "./scope";

describe("tokenModuleForPath", () => {
  test("matches exact prefixes and subpaths, not lookalike segments", () => {
    expect(tokenModuleForPath("/projects")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc/issues")).toBe("projects");
    expect(tokenModuleForPath("/issues/x/references")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc/worklists")).toBe("projects");
    expect(tokenModuleForPath("/worklists")).toBe("projects");
    expect(tokenModuleForPath("/contacts")).toBe("contacts");
    expect(tokenModuleForPath("/contact-categories")).toBe("contacts");
    expect(tokenModuleForPath("/drive/files/upload")).toBe("drive");
    expect(tokenModuleForPath("/shares/links")).toBe("shares");
    expect(tokenModuleForPath("/cron/jobs")).toBe("cron");
    expect(tokenModuleForPath("/totally-unknown")).toBeNull();
  });

  test("project default cover under /admin is a projects-scoped exception", () => {
    // The project-default-cover routes live under /admin but belong to the
    // projects domain; the ordered registry must claim them for `projects`,
    // while every other /admin path stays `account`.
    expect(tokenModuleForPath("/admin/project-default-cover")).toBe("projects");
    expect(tokenModuleForPath("/admin/users")).toBe("account");
    expect(tokenModuleForPath("/admin")).toBe("account");
  });

  test("does not confuse /shares with /shared", () => {
    expect(tokenModuleForPath("/shared/tok")).toBe("documents");
    expect(tokenModuleForPath("/shares/links")).toBe("shares");
  });

  // PLAN-108 folded the ship module into the projects domain: the three
  // fleet-wide admin prefixes moved from the `ships` scope to `projects`, and
  // the `ships` scope itself is gone. A token scoped to `projects` must reach
  // all three; nothing may still be routed to `ships`.
  test("the fleet-wide admin prefixes are claimed by projects, not ships", () => {
    expect(tokenModuleForPath("/worklists")).toBe("projects");
    expect(tokenModuleForPath("/worklists/abc12345")).toBe("projects");
    expect(tokenModuleForPath("/global-equipment-categories")).toBe("projects");
    expect(tokenModuleForPath("/global-equipment-categories/abc12345")).toBe("projects");
    expect(tokenModuleForPath("/global-equipment-manufacturers")).toBe("projects");
    expect(tokenModuleForPath("/global-equipment-manufacturers/abc12345")).toBe("projects");
  });

  test("the project-scoped ship surfaces route to projects too", () => {
    expect(tokenModuleForPath("/projects/abc12345/ship-profile")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc12345/equipment")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc12345/equipment-categories")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc12345/referenceable-worklists")).toBe("projects");
    expect(tokenModuleForPath("/projects/abc12345/sections/ship-profile")).toBe("projects");
  });

  test("no ships scope module exists and /ships is unclaimed", () => {
    // `TokenModuleKey` is derived from the manifest, so "ships" is not even a
    // valid comparison target any more — assert the runtime lists too.
    expect(TOKEN_MODULE_KEYS).not.toContain("ships");
    expect(TOKEN_MODULES.flatMap(m => m.prefixes)).not.toContain("/ships");
    expect(tokenModuleForPath("/ships")).toBeNull();
    expect(tokenModuleForPath("/ships/abc12345/equipment")).toBeNull();
  });
});

describe("a projects-scoped token after the ship fold", () => {
  const scopes: TokenScopeMap = { projects: "write" };

  const SHIP_PATHS = [
    "/worklists",
    "/global-equipment-categories",
    "/global-equipment-manufacturers",
    "/projects/abc12345/ship-profile",
    "/projects/abc12345/equipment",
    "/projects/abc12345/equipment-categories",
    "/projects/abc12345/worklists",
  ];

  test("reaches every re-keyed ship prefix for both read and write", () => {
    for (const path of SHIP_PATHS) {
      const module = tokenModuleForPath(path);
      expect(module).toBe("projects");
      for (const method of ["GET", "POST", "PATCH", "DELETE"])
        expect(scopeSatisfies(scopes[module as "projects"], levelForMethod(method))).toBe(true);
    }
  });

  test("a read-only projects token still reads them but cannot write them", () => {
    const readOnly: TokenScopeMap = { projects: "read" };
    for (const path of SHIP_PATHS) {
      expect(scopeSatisfies(readOnly.projects, levelForMethod("GET"))).toBe(true);
      expect(scopeSatisfies(readOnly.projects, levelForMethod("POST"))).toBe(false);
      expect(tokenModuleForPath(path)).toBe("projects");
    }
  });

  test("a token can no longer be scoped to ships", () => {
    expect(isValidScopeInput({ ships: "read" })).toBe(false);
    expect(parseScopes(JSON.stringify({ ships: "write", projects: "read" }))).toEqual({ projects: "read" });
  });
});

describe("levelForMethod", () => {
  test("safe methods are read, mutating methods are write", () => {
    expect(levelForMethod("GET")).toBe("read");
    expect(levelForMethod("HEAD")).toBe("read");
    expect(levelForMethod("POST")).toBe("write");
    expect(levelForMethod("patch")).toBe("write");
    expect(levelForMethod("DELETE")).toBe("write");
  });
});

describe("scopeSatisfies", () => {
  test("write implies read; read does not imply write; none satisfies nothing", () => {
    expect(scopeSatisfies("write", "read")).toBe(true);
    expect(scopeSatisfies("write", "write")).toBe(true);
    expect(scopeSatisfies("read", "read")).toBe(true);
    expect(scopeSatisfies("read", "write")).toBe(false);
    expect(scopeSatisfies(undefined, "read")).toBe(false);
    expect(scopeSatisfies(undefined, "write")).toBe(false);
  });
});

describe("parseScopes / isValidScopeInput", () => {
  test("keeps known keys/levels and drops the rest", () => {
    expect(parseScopes(JSON.stringify({ projects: "write", nope: "read", drive: "bad" }))).toEqual({ projects: "write" });
    expect(parseScopes("not json")).toEqual({});
    expect(parseScopes(JSON.stringify(["projects"]))).toEqual({});
  });

  test("isValidScopeInput rejects unknown module or level", () => {
    expect(isValidScopeInput({ projects: "read", drive: "write" })).toBe(true);
    expect(isValidScopeInput({ projects: "admin" })).toBe(false);
    expect(isValidScopeInput({ nope: "read" })).toBe(false);
    expect(isValidScopeInput({})).toBe(true);
  });
});

describe("protected router scope coverage", () => {
  test("every mounted protected prefix is claimed by exactly one token module", () => {
    const app = protectedRoutes();
    const mounted = new Set<string>();
    for (const r of (app as unknown as { routes: Array<{ path: string }> }).routes) {
      const seg = r.path.split("/")[1];
      if (!seg || seg === "*" || seg.includes("*"))
        continue;
      mounted.add(`/${seg}`);
    }
    expect(mounted.size).toBeGreaterThan(0);

    const claimCount = new Map<string, number>();
    for (const m of TOKEN_MODULES) {
      for (const p of m.prefixes)
        claimCount.set(p, (claimCount.get(p) ?? 0) + 1);
    }

    const violations: string[] = [];
    for (const prefix of [...mounted].sort()) {
      const claims = claimCount.get(prefix) ?? 0;
      if (claims !== 1)
        violations.push(`${prefix} (token-module claims=${claims})`);
    }
    expect(violations).toEqual([]);
  });
});
