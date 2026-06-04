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

// The tab loads two independent vocabularies (global worklists + equipment
// categories); route each so both sections render deterministic data.
function routeFetch(opts: { worklists?: unknown[]; categories?: unknown[] } = {}) {
  const worklists = opts.worklists ?? [];
  const categories = opts.categories ?? [];
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/worklists")
      return jsonResponse({ success: true, data: worklists });
    if (method === "GET" && path === "/tags?type=worklist")
      return jsonResponse({ success: true, data: [] });
    if (method === "GET" && path === "/global-equipment-categories")
      return jsonResponse({ success: true, data: categories });
    if (method === "POST" && path === "/global-equipment-categories")
      return jsonResponse({ success: true, data: { id: "ec9", nameZh: "电力", nameEn: "Power", code: null, description: null, createdAt: "2026-06-03T00:00:00.000Z", updatedAt: "2026-06-03T00:00:00.000Z" } });
    return new Response("not found", { status: 404 });
  });
}

describe("shipSettingsTab", () => {
  it("renders the global worklists section with its rows", async () => {
    routeFetch({
      worklists: [
        { id: "wl1", name: "Engine service", tags: [{ id: "t1", name: "Engine" }], checklist: "oil; filter", precautions: "cool down", createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });

    renderWithProviders(<ShipSettingsTab />);

    expect(screen.getByText("Global Worklists")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Engine service")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/worklists")).toBe(true);
  });

  it("shows the empty state when there are no global worklists", async () => {
    routeFetch();

    renderWithProviders(<ShipSettingsTab />);

    await waitFor(() => expect(screen.getByText("No global worklists yet.")).toBeInTheDocument());
  });

  it("opens the create dialog with the worklist fields", async () => {
    routeFetch();

    renderWithProviders(<ShipSettingsTab />);
    await waitFor(() => expect(screen.getByText("No global worklists yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New Worklist" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    // The category field is replaced by a tags picker (a combobox, not an input).
    expect(within(dialog).getByRole("combobox")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Category")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Checklist")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Precautions")).toBeInTheDocument();
  });

  it("renders the equipment categories section with name and code columns", async () => {
    routeFetch({
      categories: [
        { id: "ec1", nameZh: "电力", nameEn: "Power", code: "PWR", description: "Generators", createdAt: "2026-06-02T00:00:00.000Z", updatedAt: "2026-06-02T00:00:00.000Z" },
      ],
    });

    renderWithProviders(<ShipSettingsTab />);

    expect(screen.getByText("Equipment Category Template")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Power")).toBeInTheDocument());
    expect(screen.getByText("电力")).toBeInTheDocument();
    expect(screen.getByText("PWR")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/global-equipment-categories")).toBe(true);
  });

  it("shows the empty state when there are no equipment categories", async () => {
    routeFetch();

    renderWithProviders(<ShipSettingsTab />);

    await waitFor(() => expect(screen.getByText("No template categories yet.")).toBeInTheDocument());
  });

  it("creates an equipment category through the two-name dialog", async () => {
    routeFetch();

    renderWithProviders(<ShipSettingsTab />);
    await waitFor(() => expect(screen.getByText("No template categories yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New Category" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Chinese name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("English name")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Chinese name"), "电力");
    await userEvent.type(within(dialog).getByLabelText("English name"), "Power");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => call[1]?.method === "POST" && String(call[0]) === "/api/global-equipment-categories");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ nameZh: "电力", nameEn: "Power" });
    });
  });

  it("disables submit until both required names are filled", async () => {
    routeFetch();

    renderWithProviders(<ShipSettingsTab />);
    await waitFor(() => expect(screen.getByText("No template categories yet.")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "New Category" }));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText("Chinese name"), "电力");
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("English name"), "Power");
    expect(save).toBeEnabled();

    expect(fetchMock.mock.calls.some(call => call[1]?.method === "POST")).toBe(false);
  });
});
