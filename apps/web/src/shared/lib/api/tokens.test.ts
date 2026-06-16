import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToken, listTokens, revokeToken } from "./tokens";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

const sampleView = {
  id: "t1",
  name: "ci",
  prefix: "bithk_pat_abc",
  scopes: { projects: "write" },
  expiresAt: "2026-12-31T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  expired: false,
};

describe("tokens api client", () => {
  it("lists the caller's own tokens from the self path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [sampleView] }));
    const rows = await listTokens({ kind: "self" });
    expect(rows).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/account/me/tokens");
  });

  it("lists a target user's tokens from the admin path", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    await listTokens({ kind: "user", userId: "u 1" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/account/users/u%201/tokens");
  });

  it("creates a token and unwraps the one-time secret", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...sampleView, token: "bithk_pat_secret" } }, 201));
    const created = await createToken({ kind: "self" }, { name: "ci", expiresInDays: 30, scopes: { projects: "write" } });
    expect(created.token).toBe("bithk_pat_secret");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "ci", expiresInDays: 30, scopes: { projects: "write" } });
  });

  it("revokes a target user's token via DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    await revokeToken({ kind: "user", userId: "u1" }, "t1");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/account/users/u1/tokens/t1");
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("DELETE");
  });
});
