import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectEquipmentTab } from "./-project-equipment-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
const project = { id: "p1", name: "Serenity", sections: ["equipment"] } as unknown as ProjectView;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function categoryList() {
  return [
    { id: "ec1", nameZh: "Power (zh)", nameEn: "Power", code: "PWR", description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "ec2", nameZh: "Engine (zh)", nameEn: "Engine", code: null, description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
}

function manufacturerList() {
  return [
    { id: "mf1", name: "Volt", code: null, description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "mf2", name: "Flow", code: null, description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
}

function equipmentList() {
  return [{
    id: "eq1",
    name: "Generator",
    categoryId: "ec1",
    categoryNameZh: "Power (zh)",
    categoryNameEn: "Power",
    manufacturerId: "mf1",
    manufacturerName: "Volt",
    model: "G1",
    serialNumber: "SN-1",
    location: "Engine room",
    status: "active",
    note: "Cylinder liner overhaul in progress.",
    installedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }];
}

function routeFetch() {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/projects/p1/equipment-categories")
      return jsonResponse({ success: true, data: categoryList() });
    if (method === "GET" && path === "/global-equipment-manufacturers")
      return jsonResponse({ success: true, data: manufacturerList() });
    if (method === "GET" && path === "/projects/p1/equipment")
      return jsonResponse({ success: true, data: equipmentList() });
    if (method === "POST" && path === "/projects/p1/equipment")
      return jsonResponse({ success: true, data: { ...equipmentList()[0], id: "eq2", name: "Pump" } });
    if (method === "PATCH" && path === "/projects/p1/equipment/eq1")
      return jsonResponse({ success: true, data: { ...equipmentList()[0], name: "Generator 2" } });
    if (method === "DELETE" && path === "/projects/p1/equipment/eq1")
      return jsonResponse({ success: true, data: null });
    return new Response("not found", { status: 404 });
  });
}

describe("projectEquipmentTab", () => {
  it("renders equipment and hides write actions when the caller cannot manage", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage={false} />);

    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    expect(screen.getByText("Engine room")).toBeInTheDocument();
    expect(screen.getByText("Cylinder liner overhaul in progress.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit equipment" })).not.toBeInTheDocument();
  });

  it("filters equipment by category chip and search box", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    // The category chip is derived from the loaded rows.
    await userEvent.click(screen.getByRole("button", { name: "Power" }));
    expect(screen.getByText("Generator")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("Search name, serial, or location"), "zzz");
    expect(screen.queryByText("Generator")).not.toBeInTheDocument();
    expect(screen.getByText("No equipment matches the filters.")).toBeInTheDocument();
  });

  it("resets the category filter when its category disappears", async () => {
    const base = equipmentList()[0];
    let rows = [
      { ...base, id: "eq1", name: "Generator", categoryId: "ec1", categoryNameZh: "Power (zh)", categoryNameEn: "Power" },
      { ...base, id: "eq2", name: "Pump", categoryId: "ec2", categoryNameZh: "Engine (zh)", categoryNameEn: "Engine" },
    ];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input).replace("/api", "");
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/projects/p1/equipment-categories")
        return jsonResponse({ success: true, data: categoryList() });
      if (method === "GET" && path === "/global-equipment-manufacturers")
        return jsonResponse({ success: true, data: manufacturerList() });
      if (method === "GET" && path === "/projects/p1/equipment")
        return jsonResponse({ success: true, data: rows });
      if (method === "DELETE" && path === "/projects/p1/equipment/eq2") {
        rows = rows.filter(row => row.id !== "eq2");
        return jsonResponse({ success: true, data: null });
      }
      return new Response("not found", { status: 404 });
    });

    renderWithProviders(<ProjectEquipmentTab project={project} canManage />);
    await waitFor(() => expect(screen.getByText("Pump")).toBeInTheDocument());

    // Narrow to the "Engine" category — only the Pump row remains.
    await userEvent.click(screen.getByRole("button", { name: "Engine" }));
    expect(screen.queryByText("Generator")).not.toBeInTheDocument();

    // Delete the only Engine equipment; its category vanishes on refetch.
    await userEvent.click(screen.getByRole("button", { name: "Delete equipment" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete equipment" }).at(-1)!);

    // Filter falls back to All, so the surviving Generator is visible again.
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Engine" })).not.toBeInTheDocument();
  });

  it("associates the status select with its label in the dialog", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Status")).toBeInTheDocument();
  });

  it("resolves the equipment category by its bilingual name", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    // The row carries categoryId + bilingual names; the English name shows under en.
    expect(screen.getByRole("cell", { name: "Power" })).toBeInTheDocument();
  });

  it("sends the chosen category id when creating equipment", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Pump");

    // Pick a category from the bilingual vocabulary loaded into the select.
    await userEvent.click(within(dialog).getByLabelText("Category"));
    await userEvent.click(await screen.findByRole("option", { name: "Engine" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Pump", categoryId: "ec2" });
    });
  });

  it("creates, edits, and deletes equipment through the scoped API", async () => {
    routeFetch();
    renderWithProviders(<ProjectEquipmentTab project={project} canManage />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Name"), "Pump");
    // Manufacturer is now a Select backed by the global vocabulary, not free text.
    await userEvent.click(screen.getByLabelText("Manufacturer"));
    await userEvent.click(await screen.findByRole("option", { name: "Flow" }));
    await userEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Pump", manufacturerId: "mf2" });
    });

    await userEvent.click(screen.getByRole("button", { name: "Edit equipment" }));
    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Generator 2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(String(patch![0])).toBe("/api/projects/p1/equipment/eq1");
    });

    await userEvent.click(screen.getByRole("button", { name: "Delete equipment" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete equipment" }).at(-1)!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(call => call[1]?.method === "DELETE");
      expect(del).toBeDefined();
      expect(String(del![0])).toBe("/api/projects/p1/equipment/eq1");
    });
  });
});
