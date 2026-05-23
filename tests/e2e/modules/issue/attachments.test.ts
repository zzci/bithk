// Issue attachment lifecycle (multipart upload, download, delete) under the
// project-scoped issue routes.
import { describe, expect, it } from "bun:test";
import { createTestProject } from "../../lib/project";
import { getClient } from "../../lib/oidc";

interface Issue { id: string; title: string }
interface Attachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
}

describe("/api/projects/:projectId/issues/:id/attachments (multipart)", () => {
  it("upload → list → download → delete cycle", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    const issue = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "attachment-target" },
    });
    const issueId = issue.data.id;

    // Upload via multipart/form-data.
    const fd = new FormData();
    const payload = "hello e2e attachment";
    fd.append("file", new File([payload], "note.txt", { type: "text/plain" }));
    const upload = await admin.raw(`${base}/${issueId}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json() as { data: Attachment };
    expect(uploadBody.data.filename).toBe("note.txt");
    expect(uploadBody.data.size).toBe(payload.length);
    const attId = uploadBody.data.id;

    // List.
    const list = await admin.json<{ data: Attachment[] }>(`${base}/${issueId}/attachments`);
    expect(list.data.find(a => a.id === attId)).toBeDefined();

    // Download.
    const download = await admin.raw(`${base}/${issueId}/attachments/${attId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(payload);

    // Delete.
    await admin.raw(`${base}/${issueId}/attachments/${attId}`, { method: "DELETE" });
    const after = await admin.json<{ data: Attachment[] }>(`${base}/${issueId}/attachments`);
    expect(after.data).toHaveLength(0);

    // Cleanup.
    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  });

  it("rejects oversized files", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    const issue = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "size-target" },
    });
    const issueId = issue.data.id;

    // Service caps individual files at 10 MB. Send +1 byte so the early
    // Content-Length / per-file size check trips. The body is large enough
    // that the orchestrator's default 5s test timeout can be tight on slow
    // environments — bump to 30s.
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const fd = new FormData();
    fd.append("file", new File([big], "big.bin", { type: "application/octet-stream" }));

    const res = await admin.raw(`${base}/${issueId}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  }, 30_000);
});
