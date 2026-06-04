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

  it("does not leak the per-IP limiter onto sibling routes mounted after it", async () => {
    const app = new Hono<AppEnv>();
    // Mirror the real mount order: the share router (carrying the limiter) is
    // mounted before a sibling route, exactly as publicRoutes() lands before
    // protectedRoutes() on the same app. A bare `use("*")` would attach to this
    // later route too and rate-limit it via the shared "share-public" bucket.
    app.route("/", sharePublicRoutes());
    app.get("/account/auth/login", c => c.json({ success: true }));
    app.onError((_err, c) => c.json({ success: false }, 500));

    // Drive well past the 120/window cap; a leaked limiter would 429 here.
    let last = await app.request("/account/auth/login");
    for (let i = 0; i < 130; i++)
      last = await app.request("/account/auth/login");

    expect(last.status).toBe(200);
  });
});
