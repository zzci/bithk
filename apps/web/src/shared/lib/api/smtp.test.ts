import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useSendSmtpTest } from "./smtp";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("useSendSmtpTest", () => {
  it("pOSTs /admin/smtp/test and resolves the envelope data", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { to: "a@example.com", messageId: "<m1>" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const { result } = renderHook(() => useSendSmtpTest(), { wrapper: makeWrapper() });
    const data = await result.current.mutateAsync();
    expect(data).toEqual({ to: "a@example.com", messageId: "<m1>" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/admin/smtp/test");
    expect((init as RequestInit).method).toBe("POST");
  });
});
