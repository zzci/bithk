// Issues are project-scoped work orders: every route lives under
// `/api/projects/:projectId/issues`. An app admin both creates the project
// (admin-only) and operates inside it (admins bypass project membership), so
// the suite uses the admin client throughout.
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

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
    expect(created.data.status).toBe("todo");
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
      body: { priority: "high", status: "working" },
    });
    expect(patched.data.priority).toBe("high");
    expect(patched.data.status).toBe("working");

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

describe("/api/projects/:projectId/issues membership gate", () => {
  // Project-scope delta from the access reference (global `/api/issues`):
  // every issue route is gated on project membership, and a non-member is
  // fail-closed to 404 so neither project membership nor issue existence is
  // leaked. `user@example.com` is provisioned as a plain user (non-admin) and
  // is never added to the admin-created project, so it has no access.
  it("fail-closes a non-member to 404 on list / create / read", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const outsider = await getClient("user@example.com", "admin");
    const projectId = await createTestProject(admin);
    const base = `/api/projects/${projectId}/issues`;

    // Admin seeds an issue the outsider must not be able to see.
    const seeded = await admin.json<{ data: Issue }>(base, {
      method: "POST",
      body: { title: "members-only" },
    });
    const issueId = seeded.data.id;

    // Non-member: list, create, and read all fail-closed to 404.
    expect((await outsider.raw(base)).status).toBe(404);
    expect((await outsider.raw(base, {
      method: "POST",
      body: { title: "intruder" },
    })).status).toBe(404);
    expect((await outsider.raw(`${base}/${issueId}`)).status).toBe(404);

    // Cleanup.
    await admin.raw(`${base}/${issueId}`, { method: "DELETE" });
  });
});
