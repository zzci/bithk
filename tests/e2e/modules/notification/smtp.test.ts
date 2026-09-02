// Notification module — SMTP test send (FEAT-059). The shared e2e API runs
// with no SMTP settings, so the only reachable outcomes here are the gates:
// the relay round-trip itself is proven by the unit suite against an
// in-process smtp-server.
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

describe("POST /api/admin/smtp/test", () => {
  it("answers 409 SMTP_DISABLED while smtp.enabled is unset", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const res = await admin.raw("/api/admin/smtp/test", { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SMTP_DISABLED");
  });

  it("is admin-only (403) and needs a session (401)", async () => {
    const user = await getClient("user@example.com", "admin");
    expect((await user.raw("/api/admin/smtp/test", { method: "POST" })).status).toBe(403);
    const anon = new ApiClient();
    expect((await anon.raw("/api/admin/smtp/test", { method: "POST" })).status).toBe(401);
  });
});
