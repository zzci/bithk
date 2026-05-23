// Issue comment-attachment lifecycle: upload, list, download, delete — under
// the project-scoped issue comment routes.
import { describe, expect, it } from "bun:test";
import { createTestProject } from "../../lib/project";
import { getClient } from "../../lib/oidc";

interface Issue { id: string; title: string }
interface Comment { id: string; content: string; authorId: string }
interface Attachment { id: string; filename: string; mimetype: string; size: number }

describe("/api/projects/:projectId/issues/:id/comments/:cid/attachments", () => {
  it("upload → list → download → delete cycle", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    const issue = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: `comment-attachments ${Date.now()}` },
    });
    const issueId = issue.data.id;
    const comment = await admin.json<{ data: Comment }>(`${base}/${issueId}/comments`, {
      method: "POST",
      body: { content: "see file" },
    });
    const commentId = comment.data.id;

    const fd = new FormData();
    const payload = "issue comment attachment body";
    fd.append("file", new File([payload], "ref.txt", { type: "text/plain" }));
    const upload = await admin.raw(`${base}/${issueId}/comments/${commentId}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json() as { data: Attachment };
    expect(uploadBody.data.filename).toBe("ref.txt");
    expect(uploadBody.data.size).toBe(payload.length);
    const attId = uploadBody.data.id;

    const list = await admin.json<{ data: Attachment[] }>(`${base}/${issueId}/comments/${commentId}/attachments`);
    expect(list.data.find(a => a.id === attId)).toBeDefined();

    const download = await admin.raw(`${base}/${issueId}/comments/${commentId}/attachments/${attId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(payload);

    const del = await admin.raw(`${base}/${issueId}/comments/${commentId}/attachments/${attId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await admin.json<{ data: Attachment[] }>(`${base}/${issueId}/comments/${commentId}/attachments`);
    expect(after.data).toHaveLength(0);

    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  });
});
