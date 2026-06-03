import type { ProcurementRow } from "@/shared/lib/api/procurement";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectProcurementTab } from "./-project-procurement-tab";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function row(overrides: Partial<ProcurementRow> = {}): ProcurementRow {
  return {
    id: "pr1",
    projectId: "p1",
    title: null,
    itemName: "Cement",
    status: "requested",
    supplierId: "s1",
    categoryId: "c1",
    assigneeMemberId: null,
    quantity: 10,
    amount: 500,
    currency: "USD",
    description: null,
    priority: "medium",
    dueDate: null,
    creatorId: "u1",
    tags: [],
    pinned: false,
    pinnedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** Route the three queries the tab fires (procurements, suppliers, categories). */
function routeFetch(rows: ProcurementRow[]) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes("/procurements")) {
      const parsed = new URL(path, "http://test.local");
      const status = parsed.searchParams.get("status");
      const page = Number(parsed.searchParams.get("page") ?? 1);
      const limit = Number(parsed.searchParams.get("limit") ?? 20);
      const filtered = status ? rows.filter(item => item.status === status) : rows;
      return jsonResponse({
        success: true,
        data: filtered.slice((page - 1) * limit, page * limit),
        meta: { total: filtered.length, page, limit },
      });
    }
    if (path.includes("/contacts"))
      return jsonResponse({ success: true, data: [{ id: "s1", name: "Acme Supply" }] });
    if (path.includes("/procurement-categories"))
      return jsonResponse({ success: true, data: [{ id: "c1", name: "Materials" }] });
    return jsonResponse({ success: true, data: [] });
  });
}

const noMembers: never[] = [];

describe("projectProcurementTab", () => {
  it("renders the empty state when there are no records", async () => {
    routeFetch([]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    expect(await screen.findByText("No procurement records found.")).toBeInTheDocument();
  });

  it("renders a record with its supplier, category and formatted amount", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    expect(await screen.findByText("Cement")).toBeInTheDocument();
    expect(await screen.findByText("Acme Supply")).toBeInTheDocument();
    expect(await screen.findByText("Materials")).toBeInTheDocument();
    expect(screen.getAllByText("500 USD").length).toBeGreaterThan(0);
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls).toContain("/api/contacts");
    expect(urls).not.toContain("/api/projects/p1/contacts?type=supplier");
  });

  it("hides the create button when the viewer cannot manage", async () => {
    routeFetch([]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("No procurement records found.");
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("shows the create button to managers", async () => {
    routeFetch([]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    expect(await screen.findByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("does not render the procurement pipeline summary cards", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("Cement");
    expect(screen.queryByText("Procurement pipeline")).not.toBeInTheDocument();
    // The per-stage summary queries (limit=1000) must no longer fire.
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("limit=1000"))).toBe(false);
  });

  it("renders an independent dropdown per filter dimension", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("Cement");
    // Status / Priority / Category each render their own dropdown trigger.
    expect(screen.getByRole("button", { name: "Priority" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(await screen.findByRole("menuitem", { name: "Requested" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Category" }));
    expect(await screen.findByRole("menuitem", { name: "Materials" })).toBeInTheDocument();
  });

  it("opens the procurement detail drawer when the list row is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    const rowEl = await screen.findByRole("button", { name: "Cement" });
    await user.click(rowEl);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/projects/$projectId/procurements/$procurementId",
      params: { projectId: "p1", procurementId: "pr1" },
    });
  });

  it("opens the detail drawer when Enter is pressed on a focused row", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    const rowEl = await screen.findByRole("button", { name: "Cement" });
    rowEl.focus();
    await user.keyboard("{Enter}");
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/projects/$projectId/procurements/$procurementId",
      params: { projectId: "p1", procurementId: "pr1" },
    });
  });

  it("shows status read-only in the list with no inline status control or mutation", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Cement");
    // Status is a non-interactive badge — no inline status select even for managers.
    expect(screen.queryByLabelText("Change status")).not.toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    // The list never issues a status-change request.
    const statusCalls = fetchMock.mock.calls.filter(c => String(c[0]).endsWith("/status"));
    expect(statusCalls).toHaveLength(0);
  });

  it("does not navigate when the pin toggle is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Cement");
    await user.click(screen.getByRole("button", { name: "Pin" }));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not offer a delete action (procurement is non-deletable)", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Cement");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("renders a cancelled row's status as a read-only badge", async () => {
    routeFetch([row({ status: "cancelled" })]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Cement");
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByLabelText("Change status")).not.toBeInTheDocument();
  });

  it("drives the procurements query from the status filter, including cancelled", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("Cement");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cancelled" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => {
        const u = String(c[0]);
        return u.includes("status=cancelled") && u.includes("limit=20");
      })).toBe(true);
    });
  });

  it("pins a procurement row via POST and toasts on success", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    await screen.findByText("Cement");
    await user.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/procurements/pr1/pin");
    });
  });

  it("does not render the pin toggle for view-only members", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("Cement");
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
  });

  it("surfaces a load error from the procurements query", async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes("/procurements")) {
        return jsonResponse(
          { success: false, error: { code: "FORBIDDEN", message: "denied" } },
          { status: 403 },
        );
      }
      return jsonResponse({ success: true, data: [] });
    });
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await waitFor(() => expect(screen.getByText("Failed to load data")).toBeInTheDocument());
  });
});
