// Drive entry lifecycle over the live API: folders, files, text files,
// listing views (recent / favorites / trash), rename / favorite / move,
// trash → restore → permanent delete, plus the auth + cross-user matrix.
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface Entry {
  id: string;
  type: "folder" | "file";
  name: string;
  parentEntryId: string | null;
  favorite: boolean;
  status: "normal" | "trash";
  file: { filename: string; mimetype: string; size: number } | null;
}

function uploadForm(name: string, body: string): FormData {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type: "text/plain" }));
  return fd;
}

describe("/api/drive entries CRUD + views", () => {
  it("folder + file create, list, get, rename/favorite, recent, favorites, trash → restore → delete", async () => {
    const user = await getClient("user@example.com", "admin");

    // Create a folder at the root.
    const folder = await user.json<{ data: Entry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `e2e-folder-${Date.now()}` },
    });
    expect(folder.data.type).toBe("folder");
    const folderId = folder.data.id;

    // Upload a file into the folder (multipart).
    const fd = uploadForm("note.txt", "hello drive");
    fd.append("parentEntryId", folderId);
    const upload = await user.raw("/api/drive/files/upload", { method: "POST", formData: fd });
    expect(upload.status).toBe(201);
    const fileEntry = (await upload.json() as { data: Entry }).data;
    expect(fileEntry.type).toBe("file");
    expect(fileEntry.file?.size).toBe("hello drive".length);
    expect(fileEntry.parentEntryId).toBe(folderId);

    // List the folder's children.
    const children = await user.json<{ data: Entry[] }>(`/api/drive/entries?parentEntryId=${folderId}`);
    expect(children.data.find(e => e.id === fileEntry.id)).toBeDefined();

    // Read by id.
    const got = await user.json<{ data: Entry }>(`/api/drive/entries/${fileEntry.id}`);
    expect(got.data.id).toBe(fileEntry.id);

    // Download content round-trip.
    const dl = await user.raw(`/api/drive/entries/${fileEntry.id}/content`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe("hello drive");

    // Rename + favorite.
    const patched = await user.json<{ data: Entry }>(`/api/drive/entries/${fileEntry.id}`, {
      method: "PATCH",
      body: { name: "renamed.txt", favorite: true },
    });
    expect(patched.data.name).toBe("renamed.txt");
    expect(patched.data.favorite).toBe(true);

    // Recent + favorites views surface the file.
    const recent = await user.json<{ data: Entry[] }>("/api/drive/entries/recent");
    expect(recent.data.find(e => e.id === fileEntry.id)).toBeDefined();
    const favorites = await user.json<{ data: Entry[] }>("/api/drive/entries/favorites");
    expect(favorites.data.find(e => e.id === fileEntry.id)).toBeDefined();

    // Trash the folder subtree.
    await user.raw(`/api/drive/entries/${folderId}`, { method: "DELETE" });
    const normal = await user.json<{ data: Entry[] }>("/api/drive/entries");
    expect(normal.data.find(e => e.id === folderId)).toBeUndefined();
    const trash = await user.json<{ data: Entry[] }>("/api/drive/entries?status=trash");
    expect(trash.data.find(e => e.id === folderId)).toBeDefined();

    // Restore it.
    const restored = await user.json<{ data: Entry }>(`/api/drive/entries/${folderId}/restore`, { method: "POST" });
    expect(restored.data.status).toBe("normal");

    // Permanently delete the subtree (cleanup).
    const del = await user.raw(`/api/drive/entries/${folderId}/permanent`, { method: "DELETE" });
    expect(del.status).toBe(200);
    // The entry is gone. The capability assert runs before the existence
    // check, so a vanished entry fails closed at the policy layer (403) —
    // it never reveals whether the id ever existed.
    const gone = await user.raw(`/api/drive/entries/${folderId}`);
    expect(gone.status).toBe(403);
  });

  it("creates a server-side text file then empties the trash", async () => {
    const user = await getClient("user@example.com", "admin");

    const created = await user.json<{ data: Entry }>("/api/drive/entries/text-file", {
      method: "POST",
      body: { name: `scratch-${Date.now()}.txt`, content: "first line" },
    });
    expect(created.data.type).toBe("file");
    expect(created.data.file?.mimetype).toMatch(/^text\/plain/);

    // Trash then empty.
    await user.raw(`/api/drive/entries/${created.data.id}`, { method: "DELETE" });
    const emptied = await user.json<{ data: { removed: number } }>("/api/drive/entries/trash", { method: "DELETE" });
    expect(emptied.data.removed).toBeGreaterThanOrEqual(1);
    const trash = await user.json<{ data: Entry[] }>("/api/drive/entries?status=trash");
    expect(trash.data.find(e => e.id === created.data.id)).toBeUndefined();
  });

  it("rejects an upload over the per-file size cap", async () => {
    const user = await getClient("user@example.com", "admin");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const fd = new FormData();
    fd.append("file", new File([big], "big.txt", { type: "text/plain" }));
    const res = await user.raw("/api/drive/files/upload", { method: "POST", formData: fd });
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

describe("/api/drive entries — auth + cross-user matrix", () => {
  it("unauthenticated requests are rejected with 401", async () => {
    const anon = new ApiClient();
    const res = await anon.raw("/api/drive/entries");
    expect(res.status).toBe(401);
  });

  it("a non-owner cannot read another user's private entry (403)", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const user = await getClient("user@example.com", "admin");

    // Admin owns a private folder.
    const folder = await admin.json<{ data: Entry }>("/api/drive/folders", {
      method: "POST",
      body: { name: `admin-private-${Date.now()}` },
    });
    const folderId = folder.data.id;

    // The regular user is neither owner nor share-recipient → forbidden.
    const denied = await user.raw(`/api/drive/entries/${folderId}`);
    expect(denied.status).toBe(403);

    // Cleanup.
    await admin.raw(`/api/drive/entries/${folderId}/permanent`, { method: "DELETE" });
  });
});
