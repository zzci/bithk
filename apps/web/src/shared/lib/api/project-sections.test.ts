import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWrapper } from "@/test/utils";
import {
  projectSectionKeys,
  useCreateGlobalWorklist,
  useCreateProjectEquipment,
  useCreateProjectEquipmentCategory,
  useCreateProjectWorklist,
  useDeleteProjectEquipment,
  useDeleteProjectEquipmentCategory,
  useDeleteProjectWorklist,
  useGlobalWorklists,
  useProjectEquipment,
  useProjectEquipmentCategories,
  useProjectWorklists,
  useShipProfile,
  useUpdateProjectEquipment,
  useUpdateProjectWorklist,
  useUpdateShipProfile,
  useWorklistTags,
} from "./project-sections";

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

describe("projectSectionKeys", () => {
  it("scopes every section key under its project", () => {
    expect(projectSectionKeys.shipProfile("p1")).toEqual(["projects", "p1", "ship-profile"]);
    expect(projectSectionKeys.equipment("p1")).toEqual(["projects", "p1", "equipment"]);
    expect(projectSectionKeys.equipmentCategories("p1")).toEqual(["projects", "p1", "equipment-categories"]);
    expect(projectSectionKeys.worklists("p1")).toEqual(["projects", "p1", "worklists"]);
    // Global vocabularies are not project-scoped.
    expect(projectSectionKeys.worklistTags()).toEqual(["tags", "worklist"]);
    expect(projectSectionKeys.globalWorklists()).toEqual(["worklists", "global"]);
  });
});

describe("ship-profile section hooks", () => {
  it("reads and writes the profile on the project-scoped route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { hullNumber: "H-1", shipStatus: "active" } }));
    const read = renderHook(() => useShipProfile("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(read.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/ship-profile");

    const write = renderHook(() => useUpdateShipProfile(), { wrapper: makeWrapper() });
    write.result.current.mutate({ projectId: "p1", hullNumber: "H-2" });
    await waitFor(() => expect(write.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/projects/p1/ship-profile");
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ hullNumber: "H-2" });
  });

  it("stays disabled without a project id and never fetches", () => {
    const { result } = renderHook(() => useShipProfile(undefined), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("equipment section hooks", () => {
  it("lists, creates, updates, and deletes equipment on project-scoped routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "eq1", name: "Generator" }] }));
    const list = renderHook(() => useProjectEquipment("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/equipment");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "eq2", name: "Pump" } }));
    const create = renderHook(() => useCreateProjectEquipment(), { wrapper: makeWrapper() });
    create.result.current.mutate({ projectId: "p1", name: "Pump" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/projects/p1/equipment");
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("POST");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "eq2", name: "Pump 2" } }));
    const update = renderHook(() => useUpdateProjectEquipment(), { wrapper: makeWrapper() });
    update.result.current.mutate({ projectId: "p1", equipmentId: "eq2", name: "Pump 2" });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[2]![0])).toBe("/api/projects/p1/equipment/eq2");
    expect(fetchMock.mock.calls[2]![1]?.method).toBe("PATCH");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const remove = renderHook(() => useDeleteProjectEquipment(), { wrapper: makeWrapper() });
    remove.result.current.mutate({ projectId: "p1", equipmentId: "eq2" });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[3]![0])).toBe("/api/projects/p1/equipment/eq2");
    expect(fetchMock.mock.calls[3]![1]?.method).toBe("DELETE");
  });

  it("keeps the category vocabulary on the project-scoped route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "c1", nameZh: "Main engine (zh)", nameEn: "Main engine" }] }));
    const list = renderHook(() => useProjectEquipmentCategories("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/equipment-categories");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "c2", nameZh: "Pump (zh)", nameEn: "Pump" } }));
    const create = renderHook(() => useCreateProjectEquipmentCategory("p1"), { wrapper: makeWrapper() });
    create.result.current.mutate({ nameZh: "Pump (zh)", nameEn: "Pump" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("POST");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const remove = renderHook(() => useDeleteProjectEquipmentCategory("p1"), { wrapper: makeWrapper() });
    remove.result.current.mutate("c2");
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[2]![0])).toBe("/api/projects/p1/equipment-categories/c2");
    expect(fetchMock.mock.calls[2]![1]?.method).toBe("DELETE");
  });
});

describe("worklist section hooks", () => {
  it("fetches the worklist tag vocabulary from /tags?type=worklist", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [{ id: "t1", name: "Engine" }] }));
    const { result } = renderHook(() => useWorklistTags(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/tags?type=worklist");
  });

  it("lists a project's worklists and the global knowledge base", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "wl1", name: "Quarterly", tags: [] }] }));
    const worklists = renderHook(() => useProjectWorklists("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(worklists.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/worklists");

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "gw1", name: "Global", tags: [] }] }));
    const globals = renderHook(() => useGlobalWorklists(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(globals.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/worklists");
  });

  it("coerces a tag-less worklist row to tags:[] at the boundary (regression: .map of undefined)", async () => {
    // A contract-violating / stale-server row without `tags` must never reach
    // the UI undefined, or the unconditional `worklist.tags.map(...)` crashes.
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "wl1", name: "Quarterly" }] }));
    const scoped = renderHook(() => useProjectWorklists("p1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(scoped.result.current.isSuccess).toBe(true));
    expect(scoped.result.current.data![0]!.tags).toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [{ id: "gw1", name: "Global" }] }));
    const globals = renderHook(() => useGlobalWorklists(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(globals.result.current.isSuccess).toBe(true));
    expect(globals.result.current.data![0]!.tags).toEqual([]);
  });

  it("encodes the worklist tag filter (repeated tagId for OR semantics)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useProjectWorklists("p1", ["t1", "t2"]), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/projects/p1/worklists?");
    expect(url).toContain("tagId=t1");
    expect(url).toContain("tagId=t2");
  });

  it("creates worklists from scratch and from a global template", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "wl1", name: "Quarterly", tags: [] } }));
    const create = renderHook(() => useCreateProjectWorklist(), { wrapper: makeWrapper() });
    create.result.current.mutate({ projectId: "p1", name: "Quarterly" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/worklists");
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ name: "Quarterly" });

    create.result.current.mutate({ projectId: "p1", fromGlobalId: "gw1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({ fromGlobalId: "gw1" });
  });

  it("updates and deletes on the project-scoped worklist route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "wl1", name: "Renamed", tags: [] } }));
    const update = renderHook(() => useUpdateProjectWorklist(), { wrapper: makeWrapper() });
    update.result.current.mutate({ projectId: "p1", worklistId: "wl1", name: "Renamed" });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/worklists/wl1");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("PATCH");

    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }));
    const remove = renderHook(() => useDeleteProjectWorklist(), { wrapper: makeWrapper() });
    remove.result.current.mutate({ projectId: "p1", worklistId: "wl1" });
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/projects/p1/worklists/wl1");
    expect(fetchMock.mock.calls[1]![1]?.method).toBe("DELETE");
  });

  it("posts global templates to the admin /worklists route", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "gw1", name: "Template", tags: [] } }));
    const create = renderHook(() => useCreateGlobalWorklist(), { wrapper: makeWrapper() });
    create.result.current.mutate({ name: "Template" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/worklists");
    expect(fetchMock.mock.calls[0]![1]?.method).toBe("POST");
  });
});
