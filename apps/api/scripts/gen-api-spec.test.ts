import { describe, expect, test } from "bun:test";
import { buildSpec } from "./api-spec";
import { collectApiRoutes } from "./lib/route-table";

describe("api-spec coverage", () => {
  test("is a valid OpenAPI 3.1 document with bearer security", () => {
    const { doc } = buildSpec();
    expect(doc.openapi).toBe("3.1.0");
    const components = doc.components as { securitySchemes: { bearerAuth: { scheme: string } } };
    expect(components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  test("no curated operation references a non-existent route", () => {
    const { stale } = buildSpec();
    expect(stale).toEqual([]);
  });

  test("every mounted route has an operation (auto-stub guarantees 100% coverage)", () => {
    const { doc, uncovered } = buildSpec();
    expect(uncovered).toEqual([]);
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    for (const r of collectApiRoutes()) {
      const oaPath = r.path.replace(/:(\w+)/g, "{$1}");
      expect(paths[oaPath]?.[r.method.toLowerCase()]).toBeTruthy();
    }
  });
});
