// The file module's read pair (`/api/files/:id/metadata|content`) authorizes
// through the consumer's permission hook (looked up by `reference.ownerType`)
// and is fail-closed: missing ref, mismatched ref, or a denied hook all
// surface as 404 so file existence never leaks (decision 003).
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

interface Document { id: string }
interface Issue { id: string }
interface Attachment { id: string; fileId: string; filename: string; size: number }

async function uploadDocumentAttachment(payload: string): Promise<{ att: Attachment; docId: string }> {
  const user = await getClient("user@example.com", "admin");
  const doc = await user.json<{ data: Document }>("/api/documents", {
    method: "POST",
    body: { title: "file-module-target", content: "host doc" },
  });
  const fd = new FormData();
  fd.append("file", new File([payload], "raw.txt", { type: "text/plain" }));
  const upload = await user.raw(`/api/documents/${doc.data.id}/attachments`, {
    method: "POST",
    formData: fd,
  });
  if (upload.status !== 201)
    throw new Error(`attachment upload failed: ${upload.status}`);
  const att = (await upload.json() as { data: Attachment }).data;
  return { att, docId: doc.data.id };
}

describe("/api/files/:id read pair (happy path)", () => {
  it("serves metadata and content to an actor the owner hook admits", async () => {
    const user = await getClient("user@example.com", "admin");
    const payload = "file module e2e payload";
    const { att, docId } = await uploadDocumentAttachment(payload);

    const meta = await user.json<{ data: { id: string; size: number; filename: string; ownerType: string } }>(
      `/api/files/${att.fileId}/metadata?ref=${att.id}`,
    );
    expect(meta.data.id).toBe(att.fileId);
    expect(meta.data.filename).toBe("raw.txt");
    expect(meta.data.size).toBe(payload.length);

    const content = await user.raw(`/api/files/${att.fileId}/content?ref=${att.id}`);
    expect(content.status).toBe(200);
    expect(await content.text()).toBe(payload);
    expect(content.headers.get("Content-Disposition")).toContain("attachment");

    // `inline=true` is honoured only for browser-safe media types; text/*
    // stays a forced attachment (anti-XSS: no inline active content).
    const inline = await user.raw(`/api/files/${att.fileId}/content?ref=${att.id}&inline=true`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("Content-Disposition")).toContain("attachment");

    await user.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });

  it("404s on a missing or mismatched ref (existence hidden)", async () => {
    const user = await getClient("user@example.com", "admin");
    const { att, docId } = await uploadDocumentAttachment("ref mismatch payload");

    // No ref at all.
    expect((await user.raw(`/api/files/${att.fileId}/content`)).status).toBe(404);
    // A ref that does not exist.
    expect((await user.raw(`/api/files/${att.fileId}/content?ref=does-not-exist`)).status).toBe(404);
    // A real ref pointed at the wrong file id.
    expect((await user.raw(`/api/files/does-not-exist/content?ref=${att.id}`)).status).toBe(404);

    await user.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });
});

describe("/api/files/:id permission hook denial", () => {
  it("fail-closes to 404 when the owning resource denies the actor", async () => {
    // Admin seeds an issue attachment inside a project the plain user is not
    // a member of; the issue hook's canRead then denies the outsider.
    const admin = await getClient("admin@example.com", "admin");
    const outsider = await getClient("user@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-file-denial");

    const issue = await admin.json<{ data: Issue }>(`/api/projects/${projectId}/issues`, {
      method: "POST",
      body: { title: "attachment host" },
    });
    const fd = new FormData();
    fd.append("file", new File(["members only bytes"], "secret.txt", { type: "text/plain" }));
    const upload = await admin.raw(`/api/projects/${projectId}/issues/${issue.data.id}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const att = (await upload.json() as { data: Attachment }).data;

    // The uploader (project member via admin bypass) can read through the
    // file module directly…
    expect((await admin.raw(`/api/files/${att.fileId}/content?ref=${att.id}`)).status).toBe(200);

    // …the non-member cannot: both endpoints hide the file behind 404.
    expect((await outsider.raw(`/api/files/${att.fileId}/metadata?ref=${att.id}`)).status).toBe(404);
    expect((await outsider.raw(`/api/files/${att.fileId}/content?ref=${att.id}`)).status).toBe(404);

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});
