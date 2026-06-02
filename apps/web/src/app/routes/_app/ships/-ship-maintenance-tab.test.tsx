import type { ShipView } from "@/shared/lib/api/ships";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ShipMaintenanceTab } from "./-ship-maintenance-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
const ship = { id: "s1", name: "Serenity", baseProjectId: "p-base" } as ShipView;

const template = {
  id: "tpl1",
  name: "Quarterly check",
  category: "Engine",
  checklist: JSON.stringify(["Inspect belts", "Check oil"]),
  precautions: "Lock out power before service.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const order = {
  id: "wo1",
  title: "Quarterly check work order",
  status: "todo",
  projectId: "internal-project",
  templateRefId: "tpl1",
  referenceId: "ref1",
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

function routeFetch(referenceTemplate: unknown = template) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/ships/s1/maintenance-templates")
      return jsonResponse({ success: true, data: [template] });
    if (method === "GET" && path === "/maintenance-templates")
      return jsonResponse({ success: true, data: [{ ...template, id: "gt1", name: "Global checklist" }] });
    if (method === "GET" && path === "/ships/s1/maintenance-orders")
      return jsonResponse({ success: true, data: [order] });
    if (method === "GET" && path === "/issues/wo1/references")
      return jsonResponse({ success: true, data: [{ id: "ref1", refType: "maintenance_template", refId: "tpl1", label: null, createdAt: "2026-01-01T00:00:00.000Z", template: referenceTemplate }] });
    if (method === "POST" && path === "/ships/s1/maintenance-templates")
      return jsonResponse({ success: true, data: { ...template, id: "tpl2", name: "Hull check" } });
    if (method === "POST" && path === "/projects/p-base/issues")
      return jsonResponse({ success: true, data: { id: "wo2", title: "Quarterly check work order" } });
    return new Response("not found", { status: 404 });
  });
}

describe("shipMaintenanceTab", () => {
  it("renders templates, admin global-copy picker, and work orders", async () => {
    routeFetch();
    renderWithProviders(<ShipMaintenanceTab ship={ship} canManage />);

    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));
    expect(screen.getByText("Copy from global knowledge base")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Templates 1/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Work orders 1/ }));
    expect(screen.getByText("Quarterly check work order")).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
  });

  it("does not call the global template API for non-admin users", async () => {
    useAuthStore.setState({ user: { id: "u2", role: "user" } as never, loading: false });
    routeFetch();
    renderWithProviders(<ShipMaintenanceTab ship={ship} canManage />);

    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));
    expect(screen.queryByText("Copy from global knowledge base")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(call => String(call[0]) === "/api/maintenance-templates")).toBe(false);
  });

  it("creates a ship maintenance template from scratch", async () => {
    routeFetch();
    renderWithProviders(<ShipMaintenanceTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "Create template" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Hull check");
    await userEvent.type(within(dialog).getByLabelText("Checklist"), "- Inspect hull");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create template" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => String(call[0]) === "/api/ships/s1/maintenance-templates" && call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "Hull check", checklist: "- Inspect hull" });
    });
  });

  it("creates a work order with a maintenance_template reference and renders resolved detail", async () => {
    routeFetch();
    renderWithProviders(<ShipMaintenanceTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("tab", { name: /Work orders 1/ }));
    await waitFor(() => expect(screen.getByText("Quarterly check work order")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Open work order from template" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Open work order from template" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(call => String(call[0]) === "/api/projects/p-base/issues" && call[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string).references).toEqual([{ refType: "maintenance_template", refId: "tpl1" }]);
    });

    await userEvent.click(screen.getByRole("button", { name: "View" }));
    await waitFor(() => expect(screen.getByText("Inspect belts")).toBeInTheDocument());
    expect(screen.getAllByText("Lock out power before service.").length).toBeGreaterThan(0);
  });

  it("renders a graceful notice for dangling maintenance template references", async () => {
    routeFetch(null);
    renderWithProviders(<ShipMaintenanceTab ship={ship} canManage />);
    await waitFor(() => expect(screen.getAllByText("Quarterly check").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("tab", { name: /Work orders 1/ }));
    await waitFor(() => expect(screen.getByText("Quarterly check work order")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByText("The referenced maintenance template is no longer available.")).toBeInTheDocument();
    });
  });
});
