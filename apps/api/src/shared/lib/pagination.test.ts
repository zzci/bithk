import type { Context } from "hono";
import { describe, expect, it } from "bun:test";
import { parsePageQuery } from "./pagination";

// Minimal Hono context stub exposing only `req.query(key)`, the single
// surface `parsePageQuery` reads.
function ctx(query: Record<string, string | undefined>): Pick<Context, "req"> {
  return { req: { query: (k: string) => query[k] } } as unknown as Pick<Context, "req">;
}

describe("parsePageQuery", () => {
  it("applies built-in defaults when no params are present", () => {
    expect(parsePageQuery(ctx({}))).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("parses valid page/limit and precomputes the offset", () => {
    expect(parsePageQuery(ctx({ page: "3", limit: "20" }))).toEqual({ page: 3, limit: 20, offset: 40 });
  });

  it("clamps limit to the [1, 100] range", () => {
    expect(parsePageQuery(ctx({ limit: "1000" })).limit).toBe(100);
    expect(parsePageQuery(ctx({ limit: "0" })).limit).toBe(1);
    expect(parsePageQuery(ctx({ limit: "-5" })).limit).toBe(1);
    expect(parsePageQuery(ctx({ limit: "100" })).limit).toBe(100);
    expect(parsePageQuery(ctx({ limit: "1" })).limit).toBe(1);
  });

  it("floors page to a minimum of 1", () => {
    expect(parsePageQuery(ctx({ page: "0" })).page).toBe(1);
    expect(parsePageQuery(ctx({ page: "-3" })).page).toBe(1);
  });

  it("falls back to defaults on non-numeric or empty input", () => {
    expect(parsePageQuery(ctx({ page: "abc", limit: "xyz" }))).toEqual({ page: 1, limit: 20, offset: 0 });
    expect(parsePageQuery(ctx({ page: "", limit: "" }))).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  it("floors fractional numbers", () => {
    expect(parsePageQuery(ctx({ page: "2.9", limit: "20.7" }))).toEqual({ page: 2, limit: 20, offset: 20 });
  });

  it("honours caller-supplied defaults when params are absent", () => {
    expect(parsePageQuery(ctx({}), { page: 2, limit: 10 })).toEqual({ page: 2, limit: 10, offset: 10 });
  });

  it("lets explicit params override caller-supplied defaults", () => {
    expect(parsePageQuery(ctx({ page: "5", limit: "25" }), { page: 2, limit: 10 }))
      .toEqual({ page: 5, limit: 25, offset: 100 });
  });
});
