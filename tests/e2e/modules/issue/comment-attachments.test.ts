// Issue comment-attachment lifecycle: upload, list, download, delete,
// + author-only upload rule.
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

interface Issue { id: string; title: string }
interface Comment { id: string; content: string; authorId: string }
interface Attachment { id: string; filename: string; mimetype: string; size: number }

describe("/api/issues/:id/comments/:cid/attachments", () => {
  it("upload → list → download → delete cycle", async () => {
    const user = await getClient("user@example.com");
    const issue = await user.json<{ data: Issue }>("/api/issues", {
      method: "POST",
      body: { title: `comment-attachments ${Date.now()}` },
    });
    const issueId = issue.data.id;
    const comment = await user.json<{ data: Comment }>(`/api/issues/${issueId}/comments`, {
      method: "POST",
      body: { content: "see file" },
    });
    const commentId = comment.data.id;

    const fd = new FormData();
    const payload = "issue comment attachment body";
    fd.append("file", new File([payload], "ref.txt", { type: "text/plain" }));
    const upload = await user.raw(`/api/issues/${issueId}/comments/${commentId}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json() as { data: Attachment };
    expect(uploadBody.data.filename).toBe("ref.txt");
    expect(uploadBody.data.size).toBe(payload.length);
    const attId = uploadBody.data.id;

    const list = await user.json<{ data: Attachment[] }>(`/api/issues/${issueId}/comments/${commentId}/attachments`);
    expect(list.data.find(a => a.id === attId)).toBeDefined();

    const download = await user.raw(`/api/issues/${issueId}/comments/${commentId}/attachments/${attId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(payload);

    const del = await user.raw(`/api/issues/${issueId}/comments/${commentId}/attachments/${attId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await user.json<{ data: Attachment[] }>(`/api/issues/${issueId}/comments/${commentId}/attachments`);
    expect(after.data).toHaveLength(0);

    await user.raw(`/api/issues/${issueId}`, { method: "DELETE" });
  });
});
