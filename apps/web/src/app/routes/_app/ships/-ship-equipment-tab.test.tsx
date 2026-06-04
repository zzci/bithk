import type { ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipEquipmentTab } from "./-ship-equipment-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
const ship = { id: "s1", name: "Serenity" } as ShipView;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function categoryList() {
  return [
    { id: "ec1", nameZh: "电力", nameEn: "Power", code: "PWR", description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "ec2", nameZh: "发动机", nameEn: "Engine", code: null, description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
}

function equipmentList() {
  return [{
    id: "eq1",
    name: "Generator",
    categoryId: "ec1",
    categoryNameZh: "电力",
    categoryNameEn: "Power",
    manufacturer: "Volt",
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
    if (method === "GET" && path === "/ships/s1/equipment-categories")
      return jsonResponse({ success: true, data: categoryList() });
    if (method === "GET" && path === "/ships/s1/equipment")
      return jsonResponse({ success: true, data: equipmentList() });
    if (method === "POST" && path === "/ships/s1/equipment")
      return jsonResponse({ success: true, data: { ...equipmentList()[0], id: "eq2", name: "Pump" } });
    if (method === "PATCH" && path === "/ships/s1/equipment/eq1")
      return jsonResponse({ success: true, data: { ...equipmentList()[0], name: "Generator 2" } });
    if (method === "DELETE" && path === "/ships/s1/equipment/eq1")
      return jsonResponse({ success: true, data: null });
    return new Response("not found", { status: 404 });
  });
}

describe("shipEquipmentTab", () => {
  it("renders equipment and hides write actions when the caller cannot manage", async () => {
    routeFetch();
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage={false} />);

    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    expect(screen.getByText("Engine room")).toBeInTheDocument();
    expect(screen.getByText("Cylinder liner overhaul in progress.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit equipment" })).not.toBeInTheDocument();
  });

  it("filters equipment by category chip and search box", async () => {
    routeFetch();
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage={false} />);
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
      { ...base, id: "eq1", name: "Generator", categoryId: "ec1", categoryNameZh: "电力", categoryNameEn: "Power" },
      { ...base, id: "eq2", name: "Pump", categoryId: "ec2", categoryNameZh: "发动机", categoryNameEn: "Engine" },
    ];
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input).replace("/api", "");
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/ships/s1/equipment-categories")
        return jsonResponse({ success: true, data: categoryList() });
      if (method === "GET" && path === "/ships/s1/equipment")
        return jsonResponse({ success: true, data: rows });
      if (method === "DELETE" && path === "/ships/s1/equipment/eq2") {
        rows = rows.filter(row => row.id !== "eq2");
        return jsonResponse({ success: true, data: null });
      }
      return new Response("not found", { status: 404 });
    });

    renderWithProviders(<ShipEquipmentTab ship={ship} canManage />);
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
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Status")).toBeInTheDocument();
  });

  it("resolves the equipment category by its bilingual name", async () => {
    routeFetch();
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    // The row carries categoryId + bilingual names; the English name shows under en.
    expect(screen.getByRole("cell", { name: "Power" })).toBeInTheDocument();
  });

  it("sends the chosen category id when creating equipment", async () => {
    routeFetch();
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage />);
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
    renderWithProviders(<ShipEquipmentTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Name"), "Pump");
    await userEvent.type(screen.getByLabelText("Manufacturer"), "Flow");
    await userEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Pump", manufacturer: "Flow" });
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
      expect(String(patch![0])).toBe("/api/ships/s1/equipment/eq1");
    });

    await userEvent.click(screen.getByRole("button", { name: "Delete equipment" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete equipment" }).at(-1)!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(call => call[1]?.method === "DELETE");
      expect(del).toBeDefined();
      expect(String(del![0])).toBe("/api/ships/s1/equipment/eq1");
    });
  });
});
