import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { auditKeys, useAuditEvents } from "./audit";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
const listEnvelope = { success: true, data: [], meta: { total: 0, page: 1, limit: 50 } };

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("auditKeys", () => {
  it("builds a stable list key", () => {
    expect(auditKeys.list("u1", "auth.*", "success", 2, 50))
      .toEqual(["audit", "list", "u1", "auth.*", "success", 2, 50]);
  });
});

describe("useAuditEvents", () => {
  it("omits absent filters and defaults pagination", async () => {
    fetchMock.mockResolvedValue(jsonResponse(listEnvelope));
    const { result } = renderHook(() => useAuditEvents(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/audit?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=50");
    expect(url).not.toContain("actor_id=");
    expect(url).not.toContain("action=");
    expect(url).not.toContain("result=");
  });

  it("serialises actor, action, and result filters and unwraps data + meta", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...listEnvelope, meta: { total: 3, page: 2, limit: 50 } }));
    const { result } = renderHook(
      () => useAuditEvents({ actorId: "u1", action: "auth.*", result: "failure", page: 2 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("actor_id=u1");
    expect(url).toContain(`action=${encodeURIComponent("auth.*")}`);
    expect(url).toContain("result=failure");
    expect(url).toContain("page=2");
    expect(result.current.data?.meta.total).toBe(3);
  });
});
