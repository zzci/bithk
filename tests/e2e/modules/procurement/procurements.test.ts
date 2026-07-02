// Procurements are project-scoped: every route hangs off
// `/api/projects/:projectId/procurements` and is fail-closed on project
// membership + procurement visibility (non-member ⇒ 404, never 403).
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";
import { createTestProject } from "../../lib/project";

interface Procurement {
  id: string;
  itemName: string;
  status: string;
  priority: string;
  description: string | null;
}
interface Attachment { id: string; fileId: string; filename: string; size: number }

describe("/api/projects/:projectId/procurements CRUD", () => {
  it("creates / lists / reads / updates / transitions a procurement", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-procurement-crud");
    const base = `/api/projects/${projectId}/procurements`;

    const created = await admin.json<{ data: Procurement }>(base, {
      method: "POST",
      body: { itemName: "e2e-pump", description: "fixture", priority: "medium" },
    });
    expect(created.data.itemName).toBe("e2e-pump");
    const id = created.data.id;

    const list = await admin.json<{ data: Procurement[] }>(base);
    expect(list.data.find(p => p.id === id)).toBeDefined();

    const got = await admin.json<{ data: Procurement }>(`${base}/${id}`);
    expect(got.data.id).toBe(id);

    const patched = await admin.json<{ data: Procurement }>(`${base}/${id}`, {
      method: "PATCH",
      body: { description: "updated fixture", priority: "high" },
    });
    expect(patched.data.description).toBe("updated fixture");
    expect(patched.data.priority).toBe("high");

    // Status is a dedicated transition endpoint, not a PATCH field.
    const moved = await admin.raw(`${base}/${id}/status`, {
      method: "POST",
      body: { status: "ordered" },
    });
    expect(moved.status).toBe(200);
    const after = await admin.json<{ data: Procurement }>(`${base}/${id}`);
    expect(after.data.status).toBe("ordered");

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});

describe("/api/projects/:projectId/procurements membership gate", () => {
  it("fail-closes a non-member to 404 on list / create / read / update", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const outsider = await getClient("user@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-procurement-authz");
    const base = `/api/projects/${projectId}/procurements`;

    const seeded = await admin.json<{ data: Procurement }>(base, {
      method: "POST",
      body: { itemName: "members-only-item" },
    });
    const id = seeded.data.id;

    expect((await outsider.raw(base)).status).toBe(404);
    expect((await outsider.raw(base, {
      method: "POST",
      body: { itemName: "intruder-item" },
    })).status).toBe(404);
    expect((await outsider.raw(`${base}/${id}`)).status).toBe(404);
    expect((await outsider.raw(`${base}/${id}`, {
      method: "PATCH",
      body: { description: "intruder-edit" },
    })).status).toBe(404);

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});

describe("/api/projects/:projectId/procurements/:id/attachments", () => {
  it("upload + list + download + delete", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const projectId = await createTestProject(admin, "e2e-procurement-attach");
    const base = `/api/projects/${projectId}/procurements`;

    const created = await admin.json<{ data: Procurement }>(base, {
      method: "POST",
      body: { itemName: "attach-target" },
    });
    const id = created.data.id;

    const payload = "procurement attachment payload";
    const fd = new FormData();
    fd.append("file", new File([payload], "quote.txt", { type: "text/plain" }));
    const upload = await admin.raw(`${base}/${id}/attachments`, {
      method: "POST",
      formData: fd,
    });
    expect(upload.status).toBe(201);
    const attId = (await upload.json() as { data: Attachment }).data.id;

    const list = await admin.json<{ data: Attachment[] }>(`${base}/${id}/attachments`);
    expect(list.data.find(a => a.id === attId)).toBeDefined();

    const download = await admin.raw(`${base}/${id}/attachments/${attId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(payload);

    await admin.raw(`${base}/${id}/attachments/${attId}`, { method: "DELETE" });
    const after = await admin.json<{ data: Attachment[] }>(`${base}/${id}/attachments`);
    expect(after.data).toHaveLength(0);

    await admin.raw(`/api/projects/${projectId}`, { method: "DELETE" });
  });
});
