import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSystemPollingForTests, useSystemStore } from "./system";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  useSystemStore.setState({ status: "loading", dbError: null });
  __resetSystemPollingForTests();
});

afterEach(() => {
  useSystemStore.getState().stopPolling();
});

describe("useSystemStore.fetchStatus", () => {
  it("maps 200 + status=ready → ready", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "ready" }));
    await useSystemStore.getState().fetchStatus();
    expect(useSystemStore.getState().status).toBe("ready");
    expect(useSystemStore.getState().dbError).toBeNull();
  });

  it("maps 503 → db-error and surfaces the body status as the reason", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { status: "db_unavailable" },
      { status: 503 },
    ));
    await useSystemStore.getState().fetchStatus();
    expect(useSystemStore.getState().status).toBe("db-error");
    expect(useSystemStore.getState().dbError).toBe("db_unavailable");
  });

  it("maps other non-2xx responses to error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 500 }));
    await useSystemStore.getState().fetchStatus();
    expect(useSystemStore.getState().status).toBe("error");
  });

  it("falls into error on network rejection", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await useSystemStore.getState().fetchStatus();
    expect(useSystemStore.getState().status).toBe("error");
  });
});

describe("useSystemStore polling", () => {
  it("startPolling is idempotent — calling twice does not stack timers", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonResponse({ status: "ready" }));
      const store = useSystemStore.getState();
      store.startPolling();
      store.startPolling();
      vi.advanceTimersByTime(31_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it("stopPolling halts further fetches", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(jsonResponse({ status: "ready" }));
      const store = useSystemStore.getState();
      store.startPolling();
      store.stopPolling();
      vi.advanceTimersByTime(60_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(0);
    }
    finally {
      vi.useRealTimers();
    }
  });
});
