import { describe, expect, test } from "bun:test";
import { protectedRoutes } from "@/routes/protected";
import { TOKEN_MODULES, tokenModuleForPath } from "@/shared/module-manifest";
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
    expect(tokenModuleForPath("/ships/abc/worklists")).toBe("ships");
    expect(tokenModuleForPath("/worklists")).toBe("ships");
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
