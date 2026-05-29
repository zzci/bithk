// Issue attachment lifecycle (multipart upload, download, delete) under the
// project-scoped issue routes.
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

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
    // A non-inline-safe type (text/plain) is always served as an attachment,
    // even if `?inline=true` is requested — arbitrary uploads can't render
    // in-browser.
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const forcedInline = await admin.raw(`${base}/${issueId}/attachments/${attId}?inline=true`);
    expect(forcedInline.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toBe(payload);

    // Delete.
    await admin.raw(`${base}/${issueId}/attachments/${attId}`, { method: "DELETE" });
    const after = await admin.json<{ data: Attachment[] }>(`${base}/${issueId}/attachments`);
    expect(after.data).toHaveLength(0);

    // Cleanup.
    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  });

  it("serves an inline-safe type inline when ?inline=true", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    const issue = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "inline-target" },
    });
    const issueId = issue.data.id;

    // Minimal PNG: the 8-byte magic signature is enough for the upload
    // sniffer to confirm the declared `image/png` matches the content.
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const fd = new FormData();
    fd.append("file", new File([png], "pixel.png", { type: "image/png" }));
    const upload = await admin.raw(`${base}/${issueId}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const attId = (await upload.json() as { data: Attachment }).data.id;

    // Default download is an attachment; ?inline=true flips it to inline so
    // the browser renders it in place.
    const asAttachment = await admin.raw(`${base}/${issueId}/attachments/${attId}`);
    expect(asAttachment.headers.get("content-disposition")).toContain("attachment");
    const asInline = await admin.raw(`${base}/${issueId}/attachments/${attId}?inline=true`);
    expect(asInline.status).toBe(200);
    expect(asInline.headers.get("content-disposition")).toContain("inline");
    expect(asInline.headers.get("content-type")).toContain("image/png");

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
