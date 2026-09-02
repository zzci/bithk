// Backup module catalogue — admin-gated.
//
// `GET /api/backup/modules` feeds the admin backup tab's module picker. The
// v1 JSON export that used to share this spec was retired in FIX-072; the
// export / import round-trip now lives in `restore.test.ts` against the v2
// archive routes.

import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

describe("/api/backup/modules", () => {
  it("admin can list backup modules", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const res = await admin.json<{ modules: { name: string; deps: string[] }[] }>("/api/backup/modules");
    expect(res.modules.length).toBeGreaterThan(0);
    expect(res.modules.map(m => m.name)).toContain("users");
  });

  it("non-admin cannot hit /backup/modules (403)", async () => {
    const user = await getClient("user@example.com", "admin");
    const res = await user.raw("/api/backup/modules");
    expect(res.status).toBe(403);
  });

  it("the retired v1 JSON export route is gone (404)", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const res = await admin.raw("/api/backup/export", { method: "POST", body: { modules: ["settings"] } });
    expect(res.status).toBe(404);
  });
});
