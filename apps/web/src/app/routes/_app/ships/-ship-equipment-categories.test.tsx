import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipEquipmentCategoriesSection } from "./-ship-equipment-categories";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function categoryList() {
  return [
    { id: "ec1", nameZh: "电力", nameEn: "Power", code: "PWR", description: null, createdAt: "2026-06-03T00:00:00.000Z", updatedAt: "2026-06-03T00:00:00.000Z" },
  ];
}

function routeFetch(categories: unknown[] = categoryList()) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/ships/s1/equipment-categories")
      return jsonResponse({ success: true, data: categories });
    if (method === "POST" && path === "/ships/s1/equipment-categories")
      return jsonResponse({ success: true, data: { id: "ec9", nameZh: "导航", nameEn: "Navigation", code: null, description: null, createdAt: "2026-06-03T00:00:00.000Z", updatedAt: "2026-06-03T00:00:00.000Z" } });
    if (method === "DELETE" && path === "/ships/s1/equipment-categories/ec1")
      return jsonResponse({ success: true, data: null });
    return new Response("not found", { status: 404 });
  });
}

describe("shipEquipmentCategoriesSection", () => {
  it("lists the ship's own categories through the per-ship endpoint", async () => {
    routeFetch();
    renderWithProviders(<ShipEquipmentCategoriesSection shipShortId="s1" canManage />);

    await waitFor(() => expect(screen.getByText("Power")).toBeInTheDocument());
    expect(screen.getByText("电力")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/ships/s1/equipment-categories")).toBe(true);
  });

  it("shows the empty state when the ship has no categories", async () => {
    routeFetch([]);
    renderWithProviders(<ShipEquipmentCategoriesSection shipShortId="s1" canManage />);

    await waitFor(() => expect(screen.getByText("No equipment categories yet.")).toBeInTheDocument());
  });

  it("creates a category through the per-ship two-name dialog", async () => {
    routeFetch([]);
    renderWithProviders(<ShipEquipmentCategoriesSection shipShortId="s1" canManage />);

    await waitFor(() => expect(screen.getByText("No equipment categories yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Chinese name"), "导航");
    await userEvent.type(screen.getByLabelText("English name"), "Navigation");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === "POST" && String(call[0]) === "/api/ships/s1/equipment-categories");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ nameZh: "导航", nameEn: "Navigation" });
    });
  });

  it("disables submit until both required names are filled", async () => {
    routeFetch([]);
    renderWithProviders(<ShipEquipmentCategoriesSection shipShortId="s1" canManage />);

    await waitFor(() => expect(screen.getByText("No equipment categories yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Chinese name"), "导航");
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("English name"), "Navigation");
    expect(save).toBeEnabled();

    expect(fetchMock.mock.calls.some(call => call[1]?.method === "POST")).toBe(false);
  });
});
