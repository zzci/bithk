import type { Context } from "hono";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { optionalPageQueryFields, pageQueryFields, parsePageQuery } from "./pagination";

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

  it("honours a caller-supplied maxLimit", () => {
    expect(parsePageQuery(ctx({ limit: "150" }), { limit: 50, maxLimit: 200 }).limit).toBe(150);
    expect(parsePageQuery(ctx({ limit: "500" }), { limit: 50, maxLimit: 200 }).limit).toBe(200);
    expect(parsePageQuery(ctx({ limit: "50" }), { limit: 8, maxLimit: 20 }).limit).toBe(20);
  });
});

describe("pageQueryFields", () => {
  const schema = z.object(pageQueryFields({ defaultLimit: 50, maxLimit: 200 }));

  it("applies defaults when params are absent", () => {
    expect(schema.parse({})).toEqual({ page: 1, limit: 50 });
  });

  it("coerces string params to numbers", () => {
    expect(schema.parse({ page: "3", limit: "120" })).toEqual({ page: 3, limit: 120 });
  });

  it("rejects out-of-range values instead of clamping", () => {
    expect(schema.safeParse({ limit: "201" }).success).toBe(false);
    expect(schema.safeParse({ page: "0" }).success).toBe(false);
  });
});

describe("optionalPageQueryFields", () => {
  const schema = z.object(optionalPageQueryFields(100));

  it("leaves absent params undefined", () => {
    expect(schema.parse({})).toEqual({});
  });

  it("coerces and bounds present params", () => {
    expect(schema.parse({ page: "2", limit: "100" })).toEqual({ page: 2, limit: 100 });
    expect(schema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
