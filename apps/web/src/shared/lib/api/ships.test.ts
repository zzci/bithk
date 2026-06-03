import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  shipKeys,
  useBindShipProject,
  useCreateShip,
  useCreateShipEquipment,
  useCreateShipWorklist,
  useDeleteShip,
  useDeleteShipEquipment,
  useDeleteShipWorklist,
  useGlobalWorklists,
  useIssueReferences,
  useRemoveShipCover,
  useSetShipCover,
  useShip,
  useShipEquipment,
  useShipProjects,
  useShips,
  useShipTags,
  useShipWorklists,
  useUnbindShipProject,
  useUpdateShip,
  useUpdateShipEquipment,
  useUpdateShipWorklist,
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
    expect(shipKeys.list("active", "all", 2)).toEqual(["ships", "list", "active", "all", 2]);
    expect(shipKeys.list("active", "t1", 2, "seren")).toEqual(["ships", "list", "active", "t1", 2, "seren"]);
    expect(shipKeys.tags()).toEqual(["ships", "tags"]);
    expect(shipKeys.detail("s1")).toEqual(["ships", "detail", "s1"]);
    expect(shipKeys.projects("s1")).toEqual(["ships", "s1", "projects"]);
    expect(shipKeys.equipment("s1")).toEqual(["ships", "s1", "equipment"]);
    expect(shipKeys.worklists("s1")).toEqual(["ships", "s1", "worklists"]);
  });
});

describe("useShips", () => {
  it("encodes the status filter and pagination, unwrapping the list envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [{ id: "s1", name: "Serenity", code: "H-1", status: "active" }],
      meta: { total: 1, page: 1, limit: 20 },
    }));
    const { result } = renderHook(() => useShips({ status: "active", page: 1 }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/ships?");
    expect(url).toContain("status=active");
    expect(url).toContain("page=1");
  });

  it("encodes the tag filter (repeated tagId for OR semantics)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 20 },
    }));
    const { result } = renderHook(() => useShips({ status: "active", tagIds: ["t1", "t2"], page: 1 }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("tagId=t1");
    expect(url).toContain("tagId=t2");
  });
});

describe("useShipTags", () => {
  it("fetches the ship tag vocabulary from /tags?type=ship", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "t1", name: "Refit" }] }));
    const { result } = renderHook(() => useShipTags(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/tags?type=ship");
  });
});

describe("ship equipment hooks", () => {
  it("lists, creates, updates, and deletes equipment on scoped routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "eq1", name: "Generator" }] }));
    const list = renderHook(() => useShipEquipment("s1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/ships/s1/equipment");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "eq2", name: "Pump" } }));
    const create = renderHook(() => useCreateShipEquipment(), { wrapper: makeWrapper() });
    create.result.current.mutate({ shipId: "s1", name: "Pump" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/ships/s1/equipment");
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("POST");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "eq2", name: "Pump 2" } }));
    const update = renderHook(() => useUpdateShipEquipment(), { wrapper: makeWrapper() });
    update.result.current.mutate({ shipId: "s1", equipmentId: "eq2", name: "Pump 2" });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[2]![0])).toBe("/api/ships/s1/equipment/eq2");
    expect(fetchMock.mock.calls[2]![1]?.method).toBe("PATCH");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const remove = renderHook(() => useDeleteShipEquipment(), { wrapper: makeWrapper() });
    remove.result.current.mutate({ shipId: "s1", equipmentId: "eq2" });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[3]![0])).toBe("/api/ships/s1/equipment/eq2");
    expect(fetchMock.mock.calls[3]![1]?.method).toBe("DELETE");
  });
});

describe("ship worklist hooks", () => {
  it("lists ship worklists, global worklists, and issue references", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "wl1", name: "Quarterly" }] }));
    const worklists = renderHook(() => useShipWorklists("s1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(worklists.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/ships/s1/worklists");

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "gw1", name: "Global" }] }));
    const globals = renderHook(() => useGlobalWorklists(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(globals.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/worklists");

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "ref1", refType: "worklist", refId: "wl1", worklist: null }] }));
    const refs = renderHook(() => useIssueReferences("wo1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(refs.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[2]![0])).toBe("/api/issues/wo1/references");
  });

  it("creates ship worklists from scratch and from a global source", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "wl1", name: "Quarterly" } }));
    const create = renderHook(() => useCreateShipWorklist(), { wrapper: makeWrapper() });
    create.result.current.mutate({ shipId: "s1", name: "Quarterly" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ name: "Quarterly" });

    create.result.current.mutate({ shipId: "s1", fromGlobalId: "gw1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ fromGlobalId: "gw1" });
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

describe("ship mutation hooks", () => {
  it("useUpdateShip patches /ships/:id and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "s1", name: "Renamed" } }));
    const { result } = renderHook(() => useUpdateShip(), { wrapper: makeWrapper() });
    result.current.mutate({ id: "s1", name: "Renamed" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1");
    expect(init?.method).toBe("PATCH");
    // The id is stripped from the body; only the patch fields are sent.
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Renamed" });
    expect(result.current.data?.name).toBe("Renamed");
  });

  it("useSetShipCover posts multipart form data to the cover-image route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "s1", coverImageUrl: "/api/files/f/content" } }));
    const { result } = renderHook(() => useSetShipCover(), { wrapper: makeWrapper() });
    const file = new File(["x"], "cover.png", { type: "image/png" });
    result.current.mutate({ id: "s1", file });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1/cover-image");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init!.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("useRemoveShipCover deletes the cover-image route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "s1", coverImageUrl: null } }));
    const { result } = renderHook(() => useRemoveShipCover(), { wrapper: makeWrapper() });
    result.current.mutate("s1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1/cover-image");
    expect(init?.method).toBe("DELETE");
  });

  it("useDeleteShip deletes /ships/:id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteShip(), { wrapper: makeWrapper() });
    result.current.mutate("s1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1");
    expect(init?.method).toBe("DELETE");
  });

  it("useUpdateShipWorklist patches the scoped worklist route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "wl1", name: "Renamed" } }));
    const { result } = renderHook(() => useUpdateShipWorklist(), { wrapper: makeWrapper() });
    result.current.mutate({ shipId: "s1", worklistId: "wl1", name: "Renamed" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1/worklists/wl1");
    expect(init?.method).toBe("PATCH");
    // shipId and worklistId are path params, not body fields.
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Renamed" });
  });

  it("useDeleteShipWorklist deletes the scoped worklist route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const { result } = renderHook(() => useDeleteShipWorklist(), { wrapper: makeWrapper() });
    result.current.mutate({ shipId: "s1", worklistId: "wl1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/ships/s1/worklists/wl1");
    expect(init?.method).toBe("DELETE");
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
