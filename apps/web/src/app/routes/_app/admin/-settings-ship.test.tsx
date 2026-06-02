import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipSettingsTab } from "./-settings-ship";

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
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("shipSettingsTab", () => {
  it("renders the worklist categories section with its rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        { id: "wc1", name: "Routine Maintenance", description: "Scheduled upkeep", createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    }));

    renderWithProviders(<ShipSettingsTab />);

    expect(screen.getByText("Worklist Categories")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Routine Maintenance")).toBeInTheDocument());
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/worklist-categories");
  });

  it("shows the empty state when there are no categories", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));

    renderWithProviders(<ShipSettingsTab />);

    await waitFor(() => expect(screen.getByText("No worklist categories yet.")).toBeInTheDocument());
  });
});
