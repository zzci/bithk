// Backup export — admin-gated, plain JSON snapshot.
//
// The export endpoint streams a complete JSON snapshot of the running DB.
// No challenge/DEK proof is needed: the DB is plaintext and the endpoint
// is gated solely on the admin role.

import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

describe("/api/backup/export", () => {
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

  it("admin export returns a JSON body with the requested modules", async () => {
    const admin = await getClient("admin@example.com", "admin");

    const res = await admin.raw("/api/backup/export", {
      method: "POST",
      body: { modules: ["users", "settings"] },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    // Filename slug is derived from APP_NAME on the server side; default "app".
    expect(res.headers.get("content-disposition")).toMatch(/attachment.*-backup-/);

    const body = await res.json() as { modules: string[]; tables: Record<string, unknown[]> };
    expect(body.modules).toContain("users");
    expect(body.modules).toContain("settings");
    // Tables block carries the actual rows, keyed by table name.
    expect(typeof body.tables).toBe("object");
  });
});
