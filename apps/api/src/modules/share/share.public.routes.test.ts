import type { AppEnv } from "@/shared/lib/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { __resetRateLimitForTests } from "@/shared/middleware/rate-limit";
import { sharePublicRoutes } from "./share.public.routes";

// The IP-keyed limiter shares process-global bucket state, so reset it around
// each case to keep the synthetic-request `unknown` bucket from bleeding across
// tests (and across sibling suites that exercise the same public router).
beforeEach(() => __resetRateLimitForTests());
afterEach(() => __resetRateLimitForTests());

describe("public share routes — rate limiting", () => {
  it("returns 429 once the per-IP window is exhausted", async () => {
    const app = new Hono<AppEnv>();
    app.route("/", sharePublicRoutes());
    // Handlers reach for a `db` we don't wire here; the limiter runs first, so
    // pre-limit requests surface as a non-429 error and the boundary is 429.
    app.onError((_err, c) => c.json({ success: false }, 500));

    const first = await app.request("/shared/anything");
    expect(first.status).not.toBe(429);

    // The router is configured for max 120 per window; drive past it.
    let last = first;
    for (let i = 0; i < 121; i++)
      last = await app.request("/shared/anything");

    expect(last.status).toBe(429);
  });
});
