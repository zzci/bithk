import type { ApiClient } from "../../lib/api";
// Team directories over the live API: directory CRUD, member management
// (admin-only), and the role gate on uploads (editor can, viewer cannot).
import { describe, expect, it } from "bun:test";
import { getClient } from "../../lib/oidc";

interface Directory { id: string; name: string; role: string; memberCount: number }
interface Member { id: string; userId: string; role: string }
interface Entry { id: string }

function uploadForm(name: string, body: string, ownerId: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type: "text/plain" }));
  fd.append("ownerType", "team_directory");
  fd.append("ownerId", ownerId);
  return fd;
}

async function userId(admin: ApiClient, email: string): Promise<string> {
  const users = await admin.json<{ data: { id: string; email: string }[] }>("/api/account/users");
  const id = users.data.find(u => u.email === email)?.id;
  if (!id)
    throw new Error(`user ${email} missing from directory`);
  return id;
}

describe("/api/drive/team-directories", () => {
  it("admin creates a directory, manages members, and gates uploads by role", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const user = await getClient("user@example.com", "admin");
    const memberId = await userId(admin, "user@example.com");

    // Create + list + get.
    const created = await admin.json<{ data: Directory }>("/api/drive/team-directories", {
      method: "POST",
      body: { name: `team-${Date.now()}`, description: "shared space" },
    });
    expect(created.data.role).toBe("admin");
    const dirId = created.data.id;

    const list = await admin.json<{ data: Directory[] }>("/api/drive/team-directories");
    expect(list.data.find(d => d.id === dirId)).toBeDefined();
    const got = await admin.json<{ data: Directory }>(`/api/drive/team-directories/${dirId}`);
    expect(got.data.id).toBe(dirId);

    // Rename (PUT directory).
    const renamed = await admin.json<{ data: Directory }>(`/api/drive/team-directories/${dirId}`, {
      method: "PUT",
      body: { name: "renamed-team" },
    });
    expect(renamed.data.name).toBe("renamed-team");

    // Add the user as an editor.
    const added = await admin.json<{ data: Member }>(`/api/drive/team-directories/${dirId}/members`, {
      method: "POST",
      body: { userId: memberId, role: "editor" },
    });
    expect(added.data.role).toBe("editor");

    const members = await admin.json<{ data: Member[] }>(`/api/drive/team-directories/${dirId}/members`);
    expect(members.data.find(m => m.userId === memberId)).toBeDefined();

    // As an editor the user can upload into the directory.
    const uploadOk = await user.raw("/api/drive/files/upload", {
      method: "POST",
      formData: uploadForm("team-doc.txt", "team body", dirId),
    });
    expect(uploadOk.status).toBe(201);
    const entry = (await uploadOk.json() as { data: Entry }).data;

    // Demote to viewer (PUT member) → uploads are now forbidden, reads still work.
    const demoted = await admin.json<{ data: Member }>(`/api/drive/team-directories/${dirId}/members/${added.data.id}`, {
      method: "PUT",
      body: { role: "viewer" },
    });
    expect(demoted.data.role).toBe("viewer");

    const uploadDenied = await user.raw("/api/drive/files/upload", {
      method: "POST",
      formData: uploadForm("blocked.txt", "no", dirId),
    });
    expect(uploadDenied.status).toBe(403);

    // The viewer can still read the directory + download the entry.
    expect((await user.raw(`/api/drive/team-directories/${dirId}`)).status).toBe(200);
    expect((await user.raw(`/api/drive/entries/${entry.id}/content`)).status).toBe(200);

    // Member management is admin-only: the viewer cannot add members.
    const memberMgmtDenied = await user.raw(`/api/drive/team-directories/${dirId}/members`, {
      method: "POST",
      body: { userId: memberId, role: "admin" },
    });
    expect(memberMgmtDenied.status).toBe(403);

    // Remove the member (DELETE member) → the user is now a non-member and is denied.
    expect((await admin.raw(`/api/drive/team-directories/${dirId}/members/${added.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await user.raw(`/api/drive/team-directories/${dirId}`)).status).toBe(403);

    // Cleanup: drop the entry (admin bypass), then delete the now-empty directory.
    await admin.raw(`/api/drive/entries/${entry.id}/permanent`, { method: "DELETE" });
    expect((await admin.raw(`/api/drive/team-directories/${dirId}`, { method: "DELETE" })).status).toBe(200);
  });
});
