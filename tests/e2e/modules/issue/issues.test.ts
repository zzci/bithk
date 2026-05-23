// Issues are project-scoped work orders: every route lives under
// `/api/projects/:projectId/issues`. An app admin both creates the project
// (admin-only) and operates inside it (admins bypass project membership), so
// the suite uses the admin client throughout.
import { describe, expect, it } from "bun:test";
import { createTestProject } from "../../lib/project";
import { getClient } from "../../lib/oidc";

interface Issue {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  creatorId: string;
  assigneeId: string | null;
}
interface Comment { id: string; content: string }

describe("/api/projects/:projectId/issues CRUD + comments", () => {
  it("creates / lists / updates / completes / deletes an issue", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    // Create.
    const created = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "e2e-issue", description: "fixture" },
    });
    expect(created.data.title).toBe("e2e-issue");
    expect(created.data.status).toBe("open");
    const id = created.data.id;

    // List.
    const list = await admin.json<{ data: Issue[] }>(base);
    expect(list.data.find(t => t.id === id)).toBeDefined();

    // Read by id.
    const got = await admin.json<{ data: Issue }>(`${base}/${id}`);
    expect(got.data.id).toBe(id);

    // Patch: change priority + status.
    const patched = await admin.json<{ data: Issue }>(`${base}/${id}`, {
      method: "PATCH",
      body: { priority: "high", status: "in_progress" },
    });
    expect(patched.data.priority).toBe("high");
    expect(patched.data.status).toBe("in_progress");

    // Delete → the issue is gone (fail-closed 404).
    await admin.raw(`${base}/${id}`, { method: "DELETE" });
    const gone = await admin.raw(`${base}/${id}`);
    expect(gone.status).toBe(404);
  });

  it("comment lifecycle on an issue", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    const created = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "comment-target" },
    });
    const issueId = created.data.id;

    // Add a comment.
    const added = await admin.json<{ data: Comment }>(`${base}/${issueId}/comments`, {
      method: "POST",
      body: { content: "first comment" },
    });
    expect(added.data.content).toBe("first comment");

    // List comments.
    const list = await admin.json<{ data: Comment[] }>(`${base}/${issueId}/comments`);
    expect(list.data.find(c => c.id === added.data.id)).toBeDefined();

    // Delete comment.
    await admin.raw(`${base}/${issueId}/comments/${added.data.id}`, { method: "DELETE" });
    const after = await admin.json<{ data: Comment[] }>(`${base}/${issueId}/comments`);
    expect(after.data).toHaveLength(0);

    // Cleanup.
    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  });
});
