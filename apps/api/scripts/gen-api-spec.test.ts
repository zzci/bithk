import { describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import { buildApiApp, collectApiRoutes } from "./lib/route-table";

async function spec() {
  return generateSpecs(buildApiApp(), {
    documentation: { info: { title: "bithk API", version: "test" }, security: [{ bearerAuth: [] }] },
    excludeMethods: ["OPTIONS", "HEAD"],
  }) as Promise<{ openapi?: string; paths?: Record<string, Record<string, unknown>>; security?: unknown }>;
}

const KNOWN_ROUTES = new Set(
  collectApiRoutes().map(r => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
);

describe("api-spec generation", () => {
  test("produces an OpenAPI 3.1 document with bearer security", async () => {
    const doc = await spec();
    expect(doc.openapi).toMatch(/^3\.1\./);
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  test("every documented path+method maps to a real route (no stale describeRoute)", async () => {
    const doc = await spec();
    const unknown: string[] = [];
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const method of Object.keys(item)) {
        if (!KNOWN_ROUTES.has(`${method} ${path}`))
          unknown.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
