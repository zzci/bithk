import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  addAccountGroupMember,
  createAccountGroup,
  createAccountUser,
  deleteAccountGroup,
  deleteAccountUser,
  getDefaultGroupModules,
  listAccountGroupMembers,
  listAccountGroups,
  listAccountUsers,
  removeAccountGroupMember,
  updateAccountGroup,
  updateAccountUser,
  updateDefaultGroupModules,
  useAccountUsers,
} from "./account";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();
const usersEnvelope = { success: true, data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function call(index = 0): [string, RequestInit | undefined] {
  const [url, init] = fetchMock.mock.calls[index]!;
  return [String(url), init];
}

describe("useAccountUsers", () => {
  it("omits absent filters and defaults pagination", async () => {
    fetchMock.mockResolvedValue(jsonResponse(usersEnvelope));
    const { result } = renderHook(() => useAccountUsers(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url] = call();
    expect(url).toContain("/account/users?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("q=");
    expect(url).not.toContain("role=");
    expect(url).not.toContain("status=");
  });

  it("serialises search, role, and status filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(usersEnvelope));
    const { result } = renderHook(
      () => useAccountUsers({ q: "alan", role: "admin", status: "active", page: 2 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url] = call();
    expect(url).toContain("q=alan");
    expect(url).toContain("role=admin");
    expect(url).toContain("status=active");
    expect(url).toContain("page=2");
  });
});

describe("user request functions", () => {
  it("lists users and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...usersEnvelope, meta: { total: 7, page: 1, limit: 1, totalPages: 7 } }));
    const res = await listAccountUsers({ role: "admin", limit: 1 });
    expect(res.meta.total).toBe(7);
    expect(call()[0]).toContain("role=admin");
  });

  it("creates, updates, and deletes a user against /account/users", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: null }));
    await createAccountUser({ username: "tom", name: "Tom" });
    await updateAccountUser("u1", { status: "disabled" });
    await deleteAccountUser("u1");

    expect(call(0)).toEqual(["/api/account/users", expect.objectContaining({ method: "POST" })]);
    expect(call(1)).toEqual(["/api/account/users/u1", expect.objectContaining({ method: "PATCH" })]);
    expect(JSON.parse(String(call(1)[1]?.body))).toEqual({ status: "disabled" });
    expect(call(2)).toEqual(["/api/account/users/u1", expect.objectContaining({ method: "DELETE" })]);
  });
});

describe("group request functions", () => {
  it("covers the group CRUD and membership endpoints", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: [] }));

    await listAccountGroups();
    await createAccountGroup({ name: "Crew", modules: [] });
    await updateAccountGroup("g1", { name: "Crew", modules: [] });
    await deleteAccountGroup("g1");
    await listAccountGroupMembers("g1");
    await addAccountGroupMember("g1", "u1");
    await removeAccountGroupMember("g1", "u1");

    expect(fetchMock.mock.calls.map(c => [String(c[0]), c[1]?.method ?? "GET"])).toEqual([
      ["/api/account/groups", "GET"],
      ["/api/account/groups", "POST"],
      ["/api/account/groups/g1", "PATCH"],
      ["/api/account/groups/g1", "DELETE"],
      ["/api/account/groups/g1/members", "GET"],
      ["/api/account/groups/g1/members", "POST"],
      ["/api/account/groups/g1/members/u1", "DELETE"],
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[5]![1]?.body))).toEqual({ userId: "u1" });
  });

  it("reads and writes the built-in Default group modules", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: { modules: ["projects"] } }));

    const read = await getDefaultGroupModules();
    expect(read).toEqual(["projects"]);
    expect(call(0)[0]).toBe("/api/account/groups/default");
    expect(call(0)[1]?.method).toBeUndefined();

    const written = await updateDefaultGroupModules(["projects"]);
    expect(written).toEqual(["projects"]);
    expect(call(1)[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(call(1)[1]?.body))).toEqual({ modules: ["projects"] });
  });
});
