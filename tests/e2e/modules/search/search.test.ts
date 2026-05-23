// Global search over the live API. Search is owner-scoped, so the admin who
// creates the document / project / issue is also the one who finds them. A
// unique token in every title keeps the assertions deterministic across runs.
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { createTestProject } from "../../lib/project";
import { getClient } from "../../lib/oidc";

interface Hit { type: string; id: string; title: string; subtitle?: string }
interface SearchResult {
  documents: Hit[];
  issues: Hit[];
  projects: Hit[];
  drive: Hit[];
}

describe("/api/search (global)", () => {
  it("finds a document, project and issue by a shared token", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const token = `srch${Date.now().toString(36)}`;

    // Document owned by the searcher.
    const doc = await admin.json<{ data: { id: string } }>("/api/documents", {
      method: "POST",
      body: { title: `${token}-doc`, content: "body" },
    });

    // Project + issue carrying the same token.
    const projectId = await createTestProject(admin, `${token}-project`);
    const issue = await admin.json<{ data: { id: string } }>(`/api/projects/${projectId}/issues`, {
      method: "POST",
      body: { title: `${token}-issue` },
    });

    const res = await admin.json<{ data: SearchResult }>(`/api/search?q=${token}`);
    expect(res.data.documents.find(h => h.id === doc.data.id)).toBeDefined();
    expect(res.data.projects.some(h => h.title.includes(token))).toBe(true);
    expect(res.data.issues.find(h => h.id === issue.data.id)).toBeDefined();

    // Cleanup.
    await admin.raw(`/api/documents/${doc.data.id}`, { method: "DELETE" });
    await admin.raw(`/api/projects/${projectId}/issues/${issue.data.id}`, { method: "DELETE" });
  });

  it("an empty query returns empty buckets without error", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const res = await admin.json<{ data: SearchResult }>("/api/search?q=");
    expect(res.data).toEqual({ documents: [], issues: [], projects: [], drive: [] });
  });

  it("requires authentication (401)", async () => {
    const anon = new ApiClient();
    const res = await anon.raw("/api/search?q=anything");
    expect(res.status).toBe(401);
  });
});
