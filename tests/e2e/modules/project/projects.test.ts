// Project lifecycle against the live API: admin-only creation, member-gated
// visibility (fail-closed 404 for non-members), membership management, and
// the cover-image attachment flow (multipart upload + magic-byte sniffing).
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

interface ProjectView {
  id: string;
  name: string;
  status: string;
  coverImageUrl: string | null;
  version: number;
}
interface Role { id: string; name: string; isSystem: boolean; kind: "owner" | "guest" | null }
interface Member { id: string; userId: string; roleId: string }
interface UserRow { id: string; email: string }

// Minimal valid 1x1 PNG — the cover upload sniffs magic bytes, so the payload
// must be a real image, not text with an image mimetype.
const PNG_1X1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
), c => c.charCodeAt(0));

async function findUserId(email: string): Promise<string> {
  const admin = await getClient("admin@example.com", "admin");
  const users = await admin.json<{ data: UserRow[] }>("/api/account/users");
  const id = users.data.find(u => u.email === email)?.id;
  if (!id)
    throw new Error(`user ${email} not found in the directory`);
  return id;
}

describe("/api/projects CRUD (admin)", () => {
  it("creates / lists / reads / renames / deletes a project", async () => {
    const admin = await getClient("admin@example.com", "admin");

    const created = await admin.json<{ data: ProjectView }>("/api/projects", {
      method: "POST",
      body: { name: "e2e-proj-crud", description: "fixture" },
    });
    const id = created.data.id;
    expect(created.data.name).toBe("e2e-proj-crud");

    const list = await admin.json<{ data: ProjectView[] }>("/api/projects");
    expect(list.data.find(p => p.id === id)).toBeDefined();

    const detail = await admin.json<{ data: ProjectView & { capabilities: string[] } }>(`/api/projects/${id}`);
    expect(detail.data.id).toBe(id);
    // Admins carry the full capability set.
    expect(detail.data.capabilities.length).toBeGreaterThan(0);

    const patched = await admin.json<{ data: ProjectView }>(`/api/projects/${id}`, {
      method: "PATCH",
      body: { name: "e2e-proj-renamed" },
    });
    expect(patched.data.name).toBe("e2e-proj-renamed");

    await admin.raw(`/api/projects/${id}`, { method: "DELETE" });
    expect((await admin.raw(`/api/projects/${id}`)).status).toBe(404);
  });
});

describe("/api/projects authz", () => {
  it("rejects project creation by a non-admin with 403", async () => {
    const user = await getClient("user@example.com", "admin");
    const res = await user.raw("/api/projects", {
      method: "POST",
      body: { name: "intruder-project" },
    });
    expect(res.status).toBe(403);
  });

  it("fail-closes a non-member to 404 on detail / update / cover upload, and hides the project from the list", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const outsider = await getClient("user@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-proj-private");

    expect((await outsider.raw(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await outsider.raw(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: { name: "intruder-rename" },
    })).status).toBe(404);

    const fd = new FormData();
    fd.append("file", new File([PNG_1X1], "cover.png", { type: "image/png" }));
    expect((await outsider.raw(`/api/projects/${projectId}/cover-image`, {
      method: "POST",
      formData: fd,
    })).status).toBe(404);

    // Non-admin list is membership-scoped, so the project must not appear.
    const list = await outsider.json<{ data: ProjectView[] }>("/api/projects");
    expect(list.data.find(p => p.id === projectId)).toBeUndefined();

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });

  it("membership grants access; removal revokes it (back to 404)", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const user = await getClient("user@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-proj-membership");
    const userId = await findUserId("user@example.com");

    // Pick a plain (non-owner, non-guest) system role to assign.
    const roles = await admin.json<{ data: Role[] }>(`/api/projects/${projectId}/roles`);
    const plainRole = roles.data.find(r => r.kind === null);
    if (!plainRole)
      throw new Error("no assignable non-owner role found");

    const added = await admin.json<{ data: Member }>(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: { userId, roleId: plainRole.id },
    });
    expect(added.data.userId).toBe(userId);

    // Member now sees the project.
    const detail = await user.json<{ data: ProjectView }>(`/api/projects/${projectId}`);
    expect(detail.data.id).toBe(projectId);

    // Remove the member — access fail-closes to 404 again.
    await admin.raw(`/api/projects/${projectId}/members/${added.data.id}`, { method: "DELETE" });
    expect((await user.raw(`/api/projects/${projectId}`)).status).toBe(404);

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});

describe("/api/projects/:id/cover-image attachment flow", () => {
  it("uploads a cover image, serves its URL on the view, then removes it", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-proj-cover");

    const fd = new FormData();
    fd.append("file", new File([PNG_1X1], "cover.png", { type: "image/png" }));
    const upload = await admin.raw(`/api/projects/${projectId}/cover-image`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(200);
    const view = (await upload.json() as { data: ProjectView }).data;
    expect(view.coverImageUrl).toBeTruthy();

    // The cover URL must serve the image back to a member.
    const img = await admin.raw(view.coverImageUrl!.replace(/^\/app/, ""));
    expect(img.status).toBe(200);

    const removed = await admin.raw(`/api/projects/${projectId}/cover-image`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const after = await admin.json<{ data: ProjectView }>(`/api/projects/${projectId}`);
    expect(after.data.coverImageUrl).toBeNull();

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});
