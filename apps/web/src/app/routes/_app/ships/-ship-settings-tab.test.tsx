import type { ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipSettingsTab } from "./-ship-settings-tab";

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

const ship = { id: "s1", name: "Serenity", baseProjectId: "p1" } as ShipView;

function categoryFetch() {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/ships/s1/equipment-categories")
      return jsonResponse({ success: true, data: [{ id: "ec1", nameZh: "电力", nameEn: "Power", code: "PWR", description: null, createdAt: "2026-06-03T00:00:00.000Z", updatedAt: "2026-06-03T00:00:00.000Z" }] });
    return new Response("not found", { status: 404 });
  });
}

describe("shipSettingsTab", () => {
  it("renders the per-ship equipment categories inline with a create entry for managers", async () => {
    categoryFetch();
    renderWithProviders(<ShipSettingsTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getByText("Power")).toBeInTheDocument());
    expect(screen.getByText("电力")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("hides the create entry for read-only viewers", async () => {
    categoryFetch();
    renderWithProviders(<ShipSettingsTab ship={ship} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Power")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});
