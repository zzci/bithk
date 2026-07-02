// Document authorization denial paths. Documents are owner-scoped through
// the policy engine with NO app-admin bypass: a caller without a read tuple
// cannot tell a private document apart from a non-existent one (404, never
// 403 — decision 003).
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface Document { id: string; version: number }

describe("/api/documents authz denial", () => {
  it("rejects unauthenticated access with 401", async () => {
    const anon = new ApiClient();
    expect((await anon.raw("/api/documents")).status).toBe(401);
    expect((await anon.raw("/api/documents", {
      method: "POST",
      body: { title: "anon-doc" },
    })).status).toBe(401);
  });

  it("fail-closes a non-shared outsider to 404 on read / update / delete / attachments / shares", async () => {
    const owner = await getClient("admin@example.com", "admin");
    const outsider = await getClient("user@example.com", "admin");

    const doc = await owner.json<{ data: Document }>("/api/documents", {
      method: "POST",
      body: { title: "private-to-admin", content: "secret" },
    });
    const docId = doc.data.id;

    expect((await outsider.raw(`/api/documents/${docId}`)).status).toBe(404);
    expect((await outsider.raw(`/api/documents/${docId}`, {
      method: "PATCH",
      body: { title: "intruder-rename", version: doc.data.version },
    })).status).toBe(404);
    expect((await outsider.raw(`/api/documents/${docId}`, { method: "DELETE" })).status).toBe(404);
    expect((await outsider.raw(`/api/documents/${docId}/attachments`)).status).toBe(404);
    expect((await outsider.raw(`/api/documents/${docId}/shares`)).status).toBe(404);

    // The private doc never appears in the outsider's list either.
    const list = await outsider.json<{ data: Document[] }>("/api/documents");
    expect(list.data.find(d => d.id === docId)).toBeUndefined();

    await owner.raw(`/api/documents/${docId}`, { method: "DELETE" });
  });
});
