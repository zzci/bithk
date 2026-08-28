import type { AppDatabase } from "@/db";
import { afterEach, describe, expect, test } from "bun:test";
import { MODULE_KEYS } from "@/shared/modules";
import { __resetSearchRegistryForTests, getSearchSources, registerSearchSource } from "./search.registry";
import { globalSearch } from "./search.service";
// Side-effect imports: register each searchable module's search source.
import "@/modules/document";
import "@/modules/drive";
import "@/modules/issue";
import "@/modules/project";

// Snapshot of the real registrations (module indexes imported above). The
// registry is process-global and module indexes only run once, so mutating
// tests must restore it for the other search test files.
const realSources = getSearchSources();

afterEach(() => {
  __resetSearchRegistryForTests();
  for (const source of realSources)
    registerSearchSource(source);
});

describe("registerSearchSource", () => {
  test("every searchable module registers its source on load", () => {
    expect(getSearchSources().map(s => s.key).sort())
      .toEqual(["documents", "drive", "issues", "projects"]);
  });

  test("a duplicate key throws", () => {
    expect(() => registerSearchSource({
      key: "documents",
      module: "documents",
      search: async () => [],
    })).toThrow("Search source already registered: documents");
  });

  test("an unregistered module is absent from the results", async () => {
    __resetSearchRegistryForTests();
    registerSearchSource({
      key: "documents",
      module: "documents",
      search: async () => [{ type: "document", id: "d1", title: "Hit" }],
    });

    // The fake source never touches the db, so no database is needed.
    const result = await globalSearch({} as AppDatabase, { userId: "u1", isAdmin: false, q: "Hit", limit: 8, modules: MODULE_KEYS });

    expect(Object.keys(result)).toEqual(["documents"]);
    expect(result.documents?.map(h => h.title)).toEqual(["Hit"]);
  });
});
