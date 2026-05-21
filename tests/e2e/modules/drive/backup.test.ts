// Drive participation in cross-cutting infra: the backup contribution
// (export round-trips a drive row) and the audit trail (a drive write
// lands an audit_events row reachable via /api/audit).
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

interface Entry { id: string; name: string }
interface AuditEvent { id: string; action: string; resourceType: string; resourceId: string }

describe("drive backup contribution", () => {
  it("/api/backup/modules lists 'drive'", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const res = await admin.json<{ modules: { name: string; deps: string[] }[] }>("/api/backup/modules");
    const drive = res.modules.find(m => m.name === "drive");
    expect(drive).toBeDefined();
    expect(drive!.deps).toContain("users");
    expect(drive!.deps).toContain("files");
  });

  it("export round-trips at least one drive_entries row", async () => {
    const admin = await getClient("admin@example.com", "admin");

    // Create a drive row so the export has something to carry.
    const folder = await admin.json<{ data: Entry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `backup-fixture-${Date.now()}` },
    });

    const res = await admin.raw("/api/backup/export", {
      method: "POST",
      body: { modules: ["users", "files", "drive"] },
    });
    expect(res.status).toBe(200);
    const dump = await res.json() as { modules: string[]; tables: Record<string, unknown[]> };
    expect(dump.modules).toContain("drive");
    const driveRows = dump.tables.drive_entries ?? [];
    expect(driveRows.find(r => (r as { id: string }).id === folder.data.id)).toBeDefined();

    // Cleanup.
    await admin.raw(`/api/drive/entries/${folder.data.id}/permanent`, { method: "DELETE" });
  });
});

describe("drive audit landing", () => {
  it("a drive write is recorded in /api/audit", async () => {
    const admin = await getClient("admin@example.com", "admin");

    const folder = await admin.json<{ data: Entry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `audit-fixture-${Date.now()}` },
    });

    const events = await admin.json<{ data: AuditEvent[] }>(
      `/api/audit?resource_type=drive_entry&action=drive.folder.created`,
    );
    const landed = events.data.find(e => e.resourceId === folder.data.id);
    expect(landed).toBeDefined();
    expect(landed!.action).toBe("drive.folder.created");

    await admin.raw(`/api/drive/entries/${folder.data.id}/permanent`, { method: "DELETE" });
  });
});
