// HR colleagues / approvals against the live API. Access is flat RBAC: the
// module gate admits any user holding the `hr` module (the e2e non-admin is
// granted every module up front), decisions and payroll mutations are
// admin-only, and PAT requests are additionally bounded by token scope
// regardless of the owner's role (FEAT-034).
import { describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";
import { getClient } from "../../lib/oidc";

interface UserRow { id: string; email: string }
interface Colleague { id: string; userId: string; title: string | null; status: string }
interface Approval { id: string; status: string }
interface Attachment { id: string; fileId: string; filename: string }
interface TokenCreated { id: string; token: string }

async function findUserId(email: string): Promise<string> {
  const admin = await getClient("admin@example.com", "admin");
  const users = await admin.json<{ data: UserRow[] }>("/api/account/users");
  const id = users.data.find(u => u.email === email)?.id;
  if (!id)
    throw new Error(`user ${email} not found in the directory`);
  return id;
}

// One colleague row per user (created lazily, shared across tests — the
// colleagues table is keyed by userId, so repeated creates would conflict).
let colleagueId: string | undefined;
async function ensureColleague(): Promise<string> {
  if (colleagueId)
    return colleagueId;
  const admin = await getClient("admin@example.com", "admin");
  const created = await admin.json<{ data: Colleague }>("/api/hr/colleagues", {
    method: "POST",
    body: { userId: await findUserId("user@example.com"), title: "Engineer" },
  });
  colleagueId = created.data.id;
  return colleagueId;
}

describe("/api/hr/colleagues CRUD", () => {
  it("creates / lists / updates / archives a colleague", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const id = await ensureColleague();

    const list = await admin.json<{ data: Colleague[] }>("/api/hr/colleagues");
    expect(list.data.find(c => c.id === id)).toBeDefined();

    const patched = await admin.json<{ data: Colleague }>(`/api/hr/colleagues/${id}`, {
      method: "PATCH",
      body: { title: "Senior Engineer", department: "Deck" },
    });
    expect(patched.data.title).toBe("Senior Engineer");

    // DELETE is a soft archive, not a hard delete.
    const archived = await admin.raw(`/api/hr/colleagues/${id}`, { method: "DELETE" });
    expect(archived.status).toBe(200);
    const archivedList = await admin.json<{ data: Colleague[] }>("/api/hr/colleagues?status=archived");
    expect(archivedList.data.find(c => c.id === id)).toBeDefined();

    // Reactivate so the later suites keep a usable fixture.
    await admin.raw(`/api/hr/colleagues/${id}`, {
      method: "PATCH",
      body: { status: "active" },
    });
  });
});

describe("/api/hr/colleagues/:id/attachments", () => {
  it("upload + list + download + delete a personal document", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const id = await ensureColleague();
    const base = `/api/hr/colleagues/${id}/attachments`;

    const payload = "passport scan bytes";
    const fd = new FormData();
    fd.append("file", new File([payload], "passport.txt", { type: "text/plain" }));
    const upload = await admin.raw(base, { method: "POST", formData: fd });
    expect(upload.status).toBe(201);
    const attId = (await upload.json() as { data: Attachment }).data.id;

    const list = await admin.json<{ data: Attachment[] }>(base);
    expect(list.data.find(a => a.id === attId)).toBeDefined();

    const download = await admin.raw(`${base}/${attId}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(payload);

    await admin.raw(`${base}/${attId}`, { method: "DELETE" });
    const after = await admin.json<{ data: Attachment[] }>(base);
    expect(after.data).toHaveLength(0);
  });
});

describe("/api/hr authz", () => {
  it("rejects unauthenticated access with 401", async () => {
    const anon = new ApiClient();
    expect((await anon.raw("/api/hr/colleagues")).status).toBe(401);
  });

  it("approval decision is admin-only: a plain hr user gets 403", async () => {
    const admin = await getClient("admin@example.com", "admin");
    const user = await getClient("user@example.com", "admin");
    const id = await ensureColleague();

    const approval = await admin.json<{ data: Approval }>("/api/hr/approvals", {
      method: "POST",
      body: { colleagueId: id, type: "leave", title: "e2e-leave-request" },
    });
    expect(approval.data.status).toBe("pending");

    // The non-admin holds the hr module (reads work) but cannot decide.
    const denied = await user.raw(`/api/hr/approvals/${approval.data.id}/decision`, {
      method: "POST",
      body: { status: "approved" },
    });
    expect(denied.status).toBe(403);

    // The admin can.
    const decided = await admin.json<{ data: Approval }>(`/api/hr/approvals/${approval.data.id}/decision`, {
      method: "POST",
      body: { status: "approved" },
    });
    expect(decided.data.status).toBe("approved");

    await admin.raw(`/api/hr/approvals/${approval.data.id}`, { method: "DELETE" });
  });

  it("PAT scope bounds hr access independent of the owner's role", async () => {
    const admin = await getClient("admin@example.com", "admin");

    // An admin-owned token WITHOUT hr scope: reads are refused (403), proving
    // the scope guard is not short-circuited by the admin role.
    const noHr = await admin.json<{ data: TokenCreated }>("/api/account/me/tokens", {
      method: "POST",
      body: { name: "e2e-no-hr", expiresInDays: 1, scopes: { documents: "read" } },
    });
    const noHrClient = new ApiClient();
    const deniedRead = await noHrClient.raw("/api/hr/colleagues", {
      headers: { Authorization: `Bearer ${noHr.data.token}` },
    });
    expect(deniedRead.status).toBe(403);

    // An hr:read token can list but not mutate (write level required).
    const readOnly = await admin.json<{ data: TokenCreated }>("/api/account/me/tokens", {
      method: "POST",
      body: { name: "e2e-hr-read", expiresInDays: 1, scopes: { hr: "read" } },
    });
    const roClient = new ApiClient();
    const allowedRead = await roClient.raw("/api/hr/colleagues", {
      headers: { Authorization: `Bearer ${readOnly.data.token}` },
    });
    expect(allowedRead.status).toBe(200);
    const deniedWrite = await roClient.raw("/api/hr/colleagues", {
      method: "POST",
      body: { userId: "irrelevant" },
      headers: { Authorization: `Bearer ${readOnly.data.token}` },
    });
    expect(deniedWrite.status).toBe(403);

    await admin.raw(`/api/account/me/tokens/${noHr.data.id}`, { method: "DELETE" });
    await admin.raw(`/api/account/me/tokens/${readOnly.data.id}`, { method: "DELETE" });
  });
});
