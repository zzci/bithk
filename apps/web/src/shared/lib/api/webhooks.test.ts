import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import { useCreateWebhook, useDeleteWebhook, useTestWebhook, useUpdateWebhook, useWebhookDeliveries, useWebhooks } from "./webhooks";

const fetchMock = vi.fn<typeof fetch>();

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

const view = { id: "wh1", name: "ops", url: "https://example.com/h", events: ["*"], enabled: true, hasSecret: false, consecutiveFailures: 0, lastDeliveryAt: null, lastDeliveryStatus: null, createdBy: "u", createdAt: "2026-09-01", updatedAt: "2026-09-01" };

describe("webhooks api layer", () => {
  it("lists subscriptions", async () => {
    fetchMock.mockResolvedValueOnce(ok({ success: true, data: [view] }));
    const { result } = renderHook(() => useWebhooks(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([view]));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/admin/webhooks");
  });

  it("creates, updates, deletes and tests through the admin routes", async () => {
    // A fresh Response per call — a shared one cannot be read twice.
    fetchMock.mockImplementation(async () => ok({ success: true, data: view }));
    const wrapper = makeWrapper();
    const create = renderHook(() => useCreateWebhook(), { wrapper });
    await create.result.current.mutateAsync({ name: "ops", url: "https://example.com/h", events: ["*"], secret: "s" });
    const update = renderHook(() => useUpdateWebhook(), { wrapper });
    await update.result.current.mutateAsync({ id: "wh1", patch: { enabled: false, secret: null } });
    const remove = renderHook(() => useDeleteWebhook(), { wrapper });
    await remove.result.current.mutateAsync("wh1");
    const test = renderHook(() => useTestWebhook(), { wrapper });
    await test.result.current.mutateAsync("wh1");

    const calls = fetchMock.mock.calls.map(c => [String(c[0]), (c[1] as RequestInit | undefined)?.method ?? "GET", (c[1] as RequestInit | undefined)?.body]);
    expect(calls).toEqual([
      ["/api/admin/webhooks", "POST", JSON.stringify({ name: "ops", url: "https://example.com/h", events: ["*"], secret: "s" })],
      ["/api/admin/webhooks/wh1", "PATCH", JSON.stringify({ enabled: false, secret: null })],
      ["/api/admin/webhooks/wh1", "DELETE", undefined],
      ["/api/admin/webhooks/wh1/test", "POST", undefined],
    ]);
  });

  it("loads deliveries only once an id is selected", async () => {
    fetchMock.mockImplementation(async () => ok({ success: true, data: [{ id: "d1", event: "webhook.test", status: "success" }], meta: { total: 1, page: 1, limit: 20 } }));
    const idle = renderHook(() => useWebhookDeliveries(null), { wrapper: makeWrapper() });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const { result } = renderHook(() => useWebhookDeliveries("wh1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/admin/webhooks/wh1/deliveries?limit=20");
  });
});
