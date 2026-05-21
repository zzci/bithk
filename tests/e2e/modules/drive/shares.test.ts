// Drive sharing over the live API: direct shares (act as the recipient to
// prove the capability grant), public links (unauth metadata + password
// download + exhaustion), and the sent / received / links inboxes.
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface Entry { id: string; name: string }
interface Share {
  id: string;
  token: string;
  shareType: "direct" | "public_link";
  permission: string;
  hasPassword: boolean;
  isActive: boolean;
}
interface PublicMeta { token: string; filename: string; requiresPassword: boolean; expired: boolean; exhausted: boolean }

function uploadForm(name: string, body: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type: "text/plain" }));
  return fd;
}

async function uploadFile(client: ApiClient, name: string, body: string): Promise<Entry> {
  const res = await client.raw("/api/drive/files/upload", { method: "POST", formData: uploadForm(name, body) });
  expect(res.status).toBe(201);
  return (await res.json() as { data: Entry }).data;
}

async function userId(admin: ApiClient, email: string): Promise<string> {
  const users = await admin.json<{ data: { id: string; email: string }[] }>("/api/account/users");
  const id = users.data.find(u => u.email === email)?.id;
  if (!id)
    throw new Error(`user ${email} missing from directory`);
  return id;
}

describe("/api/drive direct shares (cross-user grant)", () => {
  it("admin shares a file with the user, who can then read + download until revoked", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const user = await getClient("user@example.com", "admin");
    const recipientId = await userId(admin, "user@example.com");

    const file = await uploadFile(admin, `direct-${Date.now()}.txt`, "shared bytes");

    // Before the share the user is forbidden.
    expect((await user.raw(`/api/drive/entries/${file.id}`)).status).toBe(403);

    // Admin grants a direct download share.
    const share = await admin.json<{ data: Share }>(`/api/drive/entries/${file.id}/shares`, {
      method: "POST",
      body: { shareType: "direct", sharedWithUserId: recipientId, permission: "download" },
    });
    expect(share.data.shareType).toBe("direct");

    // The entry-scoped share list reports it.
    const entryShares = await admin.json<{ data: Share[] }>(`/api/drive/entries/${file.id}/shares`);
    expect(entryShares.data.find(s => s.id === share.data.id)).toBeDefined();

    // The recipient can now read and download.
    expect((await user.raw(`/api/drive/entries/${file.id}`)).status).toBe(200);
    const dl = await user.raw(`/api/drive/entries/${file.id}/content`);
    expect(await dl.text()).toBe("shared bytes");

    // Inboxes: recipient sees it in received, owner in sent.
    const received = await user.json<{ data: Share[] }>("/api/drive/shares/received");
    expect(received.data.find(s => s.id === share.data.id)).toBeDefined();
    const sent = await admin.json<{ data: Share[] }>("/api/drive/shares/sent");
    expect(sent.data.find(s => s.id === share.data.id)).toBeDefined();

    // Revoke → the user loses access again.
    expect((await admin.raw(`/api/drive/shares/${share.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await user.raw(`/api/drive/entries/${file.id}`)).status).toBe(403);

    await admin.raw(`/api/drive/entries/${file.id}/permanent`, { method: "DELETE" });
  });
});

describe("/api/drive public links", () => {
  it("create → unauth metadata → password download → exhaustion → revoke", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const file = await uploadFile(admin, `link-${Date.now()}.txt`, "public bytes");

    // Password-protected, download-capable, single-use link.
    const share = await admin.json<{ data: Share }>(`/api/drive/entries/${file.id}/shares`, {
      method: "POST",
      body: { shareType: "public_link", permission: "download", password: "letmein", maxDownloads: 1 },
    });
    expect(share.data.hasPassword).toBe(true);
    const token = share.data.token;

    // It shows up in the owner's links inbox.
    const links = await admin.json<{ data: Share[] }>("/api/drive/shares/links");
    expect(links.data.find(s => s.id === share.data.id)).toBeDefined();

    // Anonymous metadata fetch — no bytes, flags the password requirement.
    const anon = new ApiClient();
    const meta = await anon.json<{ data: PublicMeta }>(`/api/drive/shared/${token}`);
    expect(meta.data.requiresPassword).toBe(true);
    expect(meta.data.expired).toBe(false);

    // POST without / with the wrong password is rejected.
    expect((await anon.raw(`/api/drive/shared/${token}`, { method: "POST", body: {} })).status).toBe(403);
    expect((await anon.raw(`/api/drive/shared/${token}`, { method: "POST", body: { password: "nope" } })).status).toBe(403);

    // Correct password streams the bytes (consuming the only download).
    const ok = await anon.raw(`/api/drive/shared/${token}`, { method: "POST", body: { password: "letmein" } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("public bytes");

    // The single download is now exhausted → 410.
    const exhausted = await anon.raw(`/api/drive/shared/${token}`, { method: "POST", body: { password: "letmein" } });
    expect(exhausted.status).toBe(410);

    // Revoke → the link 404s entirely.
    await admin.raw(`/api/drive/shares/${share.data.id}`, { method: "DELETE" });
    expect((await anon.raw(`/api/drive/shared/${token}`)).status).toBe(404);

    await admin.raw(`/api/drive/entries/${file.id}/permanent`, { method: "DELETE" });
  });

  it("an expired link is reported and refuses download (410)", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const file = await uploadFile(admin, `expired-${Date.now()}.txt`, "stale");

    const past = new Date(Date.now() - 60_000).toISOString();
    const share = await admin.json<{ data: Share }>(`/api/drive/entries/${file.id}/shares`, {
      method: "POST",
      body: { shareType: "public_link", permission: "download", expiresAt: past },
    });
    const token = share.data.token;

    const anon = new ApiClient();
    const meta = await anon.json<{ data: PublicMeta }>(`/api/drive/shared/${token}`);
    expect(meta.data.expired).toBe(true);
    const res = await anon.raw(`/api/drive/shared/${token}`, { method: "POST", body: {} });
    expect(res.status).toBe(410);

    await admin.raw(`/api/drive/shares/${share.data.id}`, { method: "DELETE" });
    await admin.raw(`/api/drive/entries/${file.id}/permanent`, { method: "DELETE" });
  });

  it("the owner can update a link (permission + activation)", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const file = await uploadFile(admin, `update-${Date.now()}.txt`, "x");
    const share = await admin.json<{ data: Share }>(`/api/drive/entries/${file.id}/shares`, {
      method: "POST",
      body: { shareType: "public_link", permission: "view" },
    });

    const updated = await admin.json<{ data: Share }>(`/api/drive/shares/${share.data.id}`, {
      method: "PUT",
      body: { permission: "download", isActive: false },
    });
    expect(updated.data.permission).toBe("download");
    expect(updated.data.isActive).toBe(false);

    await admin.raw(`/api/drive/entries/${file.id}/permanent`, { method: "DELETE" });
  });
});
