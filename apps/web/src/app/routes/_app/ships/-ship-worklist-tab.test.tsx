import type { ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ShipWorklistTab } from "./-ship-worklist-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
const ship = { id: "s1", name: "Serenity", baseProjectId: "p-base" } as ShipView;

const worklist = {
  id: "wl1",
  name: "Quarterly check",
  tags: [{ id: "t1", name: "Engine" }],
  checklist: JSON.stringify(["Inspect belts", "Check oil"]),
  precautions: "Lock out power before service.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// A global knowledge-base template the create dialog can start from. Carries a
// distinct tag so prefill is observable.
const globalWorklist = {
  ...worklist,
  id: "gw1",
  name: "Global checklist",
  tags: [{ id: "t2", name: "Hull" }],
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: { id: "u1", role: "admin" } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: false });
});

function routeFetch() {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/tags?type=worklist")
      return jsonResponse({ success: true, data: [{ id: "t1", name: "Engine", usageCount: 1 }] });
    // The ship worklist list may carry a `?tagId=` filter query.
    if (method === "GET" && path.startsWith("/ships/s1/worklists"))
      return jsonResponse({ success: true, data: [worklist] });
    if (method === "GET" && path === "/worklists")
      return jsonResponse({ success: true, data: [globalWorklist] });
    if (method === "POST" && path === "/ships/s1/worklists")
      return jsonResponse({ success: true, data: { ...worklist, id: "wl2", name: "Hull check" } });
    return new Response("not found", { status: 404 });
  });
}

describe("shipWorklistTab", () => {
  it("renders worklists with their tags", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);

    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));
    // The worklist's tag renders as a badge on its card.
    expect(screen.getByText("Engine")).toBeInTheDocument();
  });

  it("filters worklists by tag via the ListFilter", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    // Open the tag dropdown and select "Engine" via its checkbox item.
    await userEvent.click(screen.getByRole("button", { name: "Tags" }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Engine" }));

    // tagId reaches the ship worklist list query (one repeatable param per id).
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c =>
        String(c[0]).includes("/ships/s1/worklists?") && String(c[0]).includes("tagId=t1"))).toBe(true);
    });
  });

  it("renders the start-from-template selector with blank and global options", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(await screen.findByLabelText("Start from template"));
    expect(await screen.findByRole("option", { name: "Blank" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Global checklist" })).toBeInTheDocument();
  });

  it("prefills name and tags when a template is picked", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(await screen.findByLabelText("Start from template"));
    await userEvent.click(await screen.findByRole("option", { name: "Global checklist" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Global checklist");
    // The template's tag rides into the form as a removable chip.
    expect(within(dialog).getByRole("button", { name: "Remove tag Hull" })).toBeInTheDocument();
  });

  it("resets the form when the blank template option is chosen", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(await screen.findByLabelText("Start from template"));
    await userEvent.click(await screen.findByRole("option", { name: "Global checklist" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Global checklist");

    await userEvent.click(within(dialog).getByLabelText("Start from template"));
    await userEvent.click(await screen.findByRole("option", { name: "Blank" }));
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).queryByRole("button", { name: "Remove tag Hull" })).not.toBeInTheDocument();
  });

  it("submits the edited form via the create path without fromGlobalId", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(await screen.findByLabelText("Start from template"));
    await userEvent.click(await screen.findByRole("option", { name: "Global checklist" }));

    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByLabelText("Name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Hull check");
    await userEvent.click(within(dialog).getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]) === "/api/ships/s1/worklists" && c[1]?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(post![1]!.body as string);
      expect(body).toMatchObject({ name: "Hull check", tags: ["Hull"] });
      expect(body).not.toHaveProperty("fromGlobalId");
    });
  });

  it("does not render the template selector in edit mode", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "Edit worklist" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Start from template")).not.toBeInTheDocument();
  });

  it("no longer renders a category field in the create dialog", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/category/i)).not.toBeInTheDocument();
  });

  it("creates a ship worklist from scratch", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Hull check");
    await userEvent.type(within(dialog).getByLabelText("Checklist"), "- Inspect hull");
    await userEvent.click(within(dialog).getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => String(call[0]) === "/api/ships/s1/worklists" && call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Hull check", checklist: "- Inspect hull" });
    });
  });
});
