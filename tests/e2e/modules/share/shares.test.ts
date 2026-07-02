// Share management (`/api/shares/*`, authenticated) + anonymous token access
// (`/api/shared/:token`). Update / revoke are ownership-based — even an app
// admin cannot touch another user's share (403). Public links gate on
// password and die on revoke (404, existence hidden).
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface Document { id: string }
interface Share {
  id: string;
  resourceType: string;
  resourceId: string;
  token: string;
  shareType: string;
  permission: string;
  hasPassword: boolean;
  isActive: boolean;
}
interface UserRow { id: string; email: string }

async function createDoc(title: string): Promise<string> {
  const owner = await getClient("user@example.com", "admin");
  const doc = await owner.json<{ data: Document }>("/api/documents", {
    method: "POST",
    body: { title, content: "shared body" },
  });
  return doc.data.id;
}

describe("/api/shares management", () => {
  it("reports per-type capabilities", async () => {
    const user = await getClient("user@example.com", "admin");
    const caps = await user.json<{ data: { shareTypes: string[]; permissions: string[] } }>(
      "/api/shares/capabilities/document",
    );
    expect(caps.data.shareTypes.length).toBeGreaterThan(0);
    expect(caps.data.permissions.length).toBeGreaterThan(0);
  });

  it("public link: create, list, anonymous access, owner update, revoke → 404", async () => {
    const owner = await getClient("user@example.com", "admin");
    const docId = await createDoc("e2e-share-public");

    const created = await owner.json<{ data: Share }>(`/api/shares/document/${docId}`, {
      method: "POST",
      body: { shareType: "public_link", permission: "view" },
    });
    const share = created.data;
    expect(share.token).toBeTruthy();
    expect(share.isActive).toBe(true);

    // Shows up on the resource's share list and the owner's link inbox.
    const forResource = await owner.json<{ data: Share[] }>(`/api/shares/document/${docId}`);
    expect(forResource.data.find(s => s.id === share.id)).toBeDefined();
    const links = await owner.json<{ data: Share[] }>("/api/shares/links");
    expect(links.data.find(s => s.id === share.id)).toBeDefined();

    // Anonymous meta + content — no session at all.
    const anon = new ApiClient();
    const meta = await anon.raw(`/api/shared/${share.token}`);
    expect(meta.status).toBe(200);
    const content = await anon.raw(`/api/shared/${share.token}`, { method: "POST", body: {} });
    expect(content.status).toBe(200);

    // Owner can update (flip permission).
    const updated = await owner.json<{ data: Share }>(`/api/shares/${share.id}`, {
      method: "PATCH",
      body: { permission: "download" },
    });
    expect(updated.data.permission).toBe("download");

    // Owner revokes → the token is dead for everyone (404, not 410/403).
    await owner.raw(`/api/shares/${share.id}`, { method: "DELETE" });
    expect((await anon.raw(`/api/shared/${share.token}`)).status).toBe(404);

    await owner.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });

  it("update / revoke are owner-only: a non-owner (even admin) gets 403", async () => {
    const owner = await getClient("user@example.com", "admin");
    const admin = await getClient("admin@example.com", "admin");
    const docId = await createDoc("e2e-share-ownership");

    const created = await owner.json<{ data: Share }>(`/api/shares/document/${docId}`, {
      method: "POST",
      body: { shareType: "public_link", permission: "view" },
    });
    const shareId = created.data.id;

    expect((await admin.raw(`/api/shares/${shareId}`, {
      method: "PATCH",
      body: { isActive: false },
    })).status).toBe(403);
    expect((await admin.raw(`/api/shares/${shareId}`, { method: "DELETE" })).status).toBe(403);

    await owner.raw(`/api/shares/${shareId}`, { method: "DELETE" });
    await owner.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });

  it("direct share (drive_entry) lands in the recipient inbox; self-share is rejected", async () => {
    // Documents only support public links; drive entries carry direct shares.
    const owner = await getClient("user@example.com", "admin");
    const admin = await getClient("admin@example.com", "admin");

    const fd = new FormData();
    fd.append("file", new File(["direct share payload"], "direct.txt", { type: "text/plain" }));
    const upload = await owner.raw("/api/drive/files/upload", { method: "POST", formData: fd });
    expect(upload.status).toBe(201);
    const entryId = (await upload.json() as { data: { id: string } }).data.id;

    const users = await admin.json<{ data: UserRow[] }>("/api/account/users");
    const adminId = users.data.find(u => u.email === "admin@example.com")?.id;
    const ownerId = users.data.find(u => u.email === "user@example.com")?.id;
    if (!adminId || !ownerId)
      throw new Error("directory users missing");

    const created = await owner.json<{ data: Share }>(`/api/shares/drive_entry/${entryId}`, {
      method: "POST",
      body: { shareType: "direct", sharedWithUserId: adminId, permission: "view" },
    });

    const received = await admin.json<{ data: Share[] }>("/api/shares/received");
    expect(received.data.find(s => s.id === created.data.id)).toBeDefined();
    const sent = await owner.json<{ data: Share[] }>("/api/shares/sent");
    expect(sent.data.find(s => s.id === created.data.id)).toBeDefined();

    // Sharing with yourself is a 400.
    expect((await owner.raw(`/api/shares/drive_entry/${entryId}`, {
      method: "POST",
      body: { shareType: "direct", sharedWithUserId: ownerId, permission: "view" },
    })).status).toBe(400);

    await owner.raw(`/api/shares/${created.data.id}`, { method: "DELETE" });
    await owner.raw(`/api/drive/entries/${entryId}`, { method: "DELETE" });
  });
});

describe("/api/shared/:token password gate", () => {
  it("blocks content without the password and admits it with the right one", async () => {
    const owner = await getClient("user@example.com", "admin");
    const docId = await createDoc("e2e-share-password");

    const created = await owner.json<{ data: Share }>(`/api/shares/document/${docId}`, {
      method: "POST",
      body: { shareType: "public_link", permission: "view", password: "s3cret" },
    });
    const token = created.data.token;
    expect(created.data.hasPassword).toBe(true);

    const anon = new ApiClient();
    // Meta stays readable (the UI needs to know a password is required)…
    expect((await anon.raw(`/api/shared/${token}`)).status).toBe(200);
    // …but content requires the password.
    expect((await anon.raw(`/api/shared/${token}`, { method: "POST", body: {} })).status).toBe(403);
    expect((await anon.raw(`/api/shared/${token}`, {
      method: "POST",
      body: { password: "wrong" },
    })).status).toBe(403);
    expect((await anon.raw(`/api/shared/${token}`, {
      method: "POST",
      body: { password: "s3cret" },
    })).status).toBe(200);

    await owner.raw(`/api/shares/${created.data.id}`, { method: "DELETE" });
    await owner.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });
});
