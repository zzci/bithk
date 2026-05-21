import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";

describe("/api/health (live)", () => {
  it("returns 200 + status:ok", async () => {
    const c = new ApiClient();
    const res = await c.json<{ status: string }>("/api/health");
    expect(res.status).toBe("ok");
  });

  it("/api/health/ready returns 200 + status:ready when DB reachable", async () => {
    const c = new ApiClient();
    const res = await c.raw("/api/health/ready");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ready");
  });
});
