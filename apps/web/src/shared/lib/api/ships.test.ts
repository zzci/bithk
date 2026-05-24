import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  shipKeys,
  useBindShipProject,
  useCreateShip,
  useShip,
  useShipProjects,
  useShips,
  useUnbindShipProject,
} from "./ships";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
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

describe("shipKeys", () => {
  it("builds stable, scoped query keys", () => {
    expect(shipKeys.lists()).toEqual(["ships", "list"]);
    expect(shipKeys.list("active", "design", 2)).toEqual(["ships", "list", "active", "design", 2]);
    expect(shipKeys.detail("s1")).toEqual(["ships", "detail", "s1"]);
    expect(shipKeys.projects("s1")).toEqual(["ships", "s1", "projects"]);
  });
});

describe("useShips", () => {
  it("encodes the stage filter and pagination, unwrapping the list envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [{ id: "s1", name: "Serenity", code: "H-1", status: "active", lifecycleStage: "design" }],
      meta: { total: 1, page: 1, limit: 20 },
    }));
    const { result } = renderHook(() => useShips({ lifecycleStage: "design", page: 1 }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/ships?");
    expect(url).toContain("lifecycleStage=design");
    expect(url).toContain("page=1");
  });
});

describe("useShip", () => {
  it("stays disabled without an id and never fetches", () => {
    const { result } = renderHook(() => useShip(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the detail and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "s1", name: "Serenity" } }));
    const { result } = renderHook(() => useShip("s1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Serenity");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/ships/s1");
  });
});

describe("useCreateShip", () => {
  it("posts the payload to /ships", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "s2", name: "Aurora" } }));
    const { result } = renderHook(() => useCreateShip(), { wrapper: makeWrapper() });
    result.current.mutate({ name: "Aurora" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships");
    expect(init?.method).toBe("POST");
  });
});

describe("useShipProjects", () => {
  it("lists the ship's projects, base flag included", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [{ id: "p1", name: "Base", isBase: true }, { id: "p2", name: "Refit", isBase: false }],
    }));
    const { result } = renderHook(() => useShipProjects("s1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/ships/s1/projects");
  });
});

describe("ship project binding", () => {
  it("binds via POST and unbinds via DELETE on the scoped routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));

    const bind = renderHook(() => useBindShipProject(), { wrapper: makeWrapper() });
    bind.result.current.mutate({ shipId: "s1", projectShortId: "p2" });
    await waitFor(() => expect(bind.result.current.isSuccess).toBe(true));
    const bindCall = fetchMock.mock.calls[0]!;
    expect(String(bindCall[0])).toBe("/api/ships/s1/projects");
    expect(bindCall[1]?.method).toBe("POST");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const unbind = renderHook(() => useUnbindShipProject(), { wrapper: makeWrapper() });
    unbind.result.current.mutate({ shipId: "s1", projectShortId: "p2" });
    await waitFor(() => expect(unbind.result.current.isSuccess).toBe(true));
    const unbindCall = fetchMock.mock.calls[1]!;
    expect(String(unbindCall[0])).toBe("/api/ships/s1/projects/p2");
    expect(unbindCall[1]?.method).toBe("DELETE");
  });
});
