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

    // v2 export job (FIX-072 retired the v1 JSON route): start, poll to
    // `completed`, download the data artifact.
    const start = await admin.raw("/api/backup/v2/exports", {
      method: "POST",
      body: { modules: ["users", "files", "drive"] },
    });
    expect(start.status).toBe(202);
    const { jobId } = await start.json() as { jobId: string };
    const deadline = Date.now() + 30_000;
    let state = "pending";
    while (Date.now() < deadline && state !== "completed" && state !== "failed") {
      await Bun.sleep(200);
      state = (await admin.json<{ state: string }>(`/api/backup/v2/exports/${jobId}`)).state;
    }
    expect(state).toBe("completed");

    const res = await admin.raw(`/api/backup/v2/exports/${jobId}/download?artifact=data`);
    expect(res.status).toBe(200);
    // The archive is a gzip'd tar: manifest.json first, then one NDJSON per
    // table. Inflate it and look for the drive table + the fixture row id
    // in the raw bytes — enough to prove the row round-tripped without a
    // tar parser in the test.
    const tar = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())));
    expect(tar).toContain("\"name\": \"drive_entries\"");
    expect(tar).toContain(folder.data.id);

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
