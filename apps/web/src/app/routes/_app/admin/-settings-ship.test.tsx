import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("renders the global worklists section with its rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        { id: "wl1", name: "Engine service", category: "Engine", checklist: "oil; filter", precautions: "cool down", createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    }));

    renderWithProviders(<ShipSettingsTab />);

    expect(screen.getByText("Global Worklists")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Engine service")).toBeInTheDocument());
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/worklists");
  });

  it("shows the empty state when there are no global worklists", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));

    renderWithProviders(<ShipSettingsTab />);

    await waitFor(() => expect(screen.getByText("No global worklists yet.")).toBeInTheDocument());
  });

  it("opens the create dialog with the worklist fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));

    renderWithProviders(<ShipSettingsTab />);
    await waitFor(() => expect(screen.getByText("No global worklists yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Add Worklist" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Category")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Checklist")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Precautions")).toBeInTheDocument();
  });
});
