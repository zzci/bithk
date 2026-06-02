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
  category: "Engine",
  checklist: JSON.stringify(["Inspect belts", "Check oil"]),
  precautions: "Lock out power before service.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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
    if (method === "GET" && path === "/ships/s1/worklists")
      return jsonResponse({ success: true, data: [worklist] });
    if (method === "GET" && path === "/worklists")
      return jsonResponse({ success: true, data: [{ ...worklist, id: "gw1", name: "Global checklist" }] });
    if (method === "POST" && path === "/ships/s1/worklists")
      return jsonResponse({ success: true, data: { ...worklist, id: "wl2", name: "Hull check" } });
    return new Response("not found", { status: 404 });
  });
}

describe("shipWorklistTab", () => {
  it("renders worklists and the admin global-copy picker", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);

    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));
    expect(screen.getByText("Copy from global knowledge base")).toBeInTheDocument();
  });

  it("does not call the global worklist API for non-admin users", async () => {
    useAuthStore.setState({ user: { id: "u2", role: "user" } as never, loading: false });
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);

    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));
    expect(screen.queryByText("Copy from global knowledge base")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]) === "/api/worklists")).toBe(false);
  });

  it("creates a ship worklist from scratch", async () => {
    routeFetch();
    renderWithProviders(<ShipWorklistTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "Create worklist" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Hull check");
    await userEvent.type(within(dialog).getByLabelText("Checklist"), "- Inspect hull");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create worklist" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => String(call[0]) === "/api/ships/s1/worklists" && call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Hull check", checklist: "- Inspect hull" });
    });
  });
});
