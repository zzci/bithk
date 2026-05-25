import type { ProcurementRow } from "@/shared/lib/api/procurement";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectProcurementTab } from "./-project-procurement-tab";

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

function row(overrides: Partial<ProcurementRow> = {}): ProcurementRow {
  return {
    id: "pr1",
    projectId: "p1",
    title: null,
    itemName: "Cement",
    status: "draft",
    supplierId: "s1",
    categoryId: "c1",
    assigneeMemberId: null,
    quantity: 10,
    amount: 500,
    currency: "USD",
    creatorId: "u1",
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
    expect(screen.queryByRole("button", { name: /Create procurement/ })).not.toBeInTheDocument();
  });

  it("shows the create button to managers", async () => {
    routeFetch([]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage />,
    );
    expect(await screen.findByRole("button", { name: /Create procurement/ })).toBeInTheDocument();
  });

  it("renders the pipeline summary with all five stages", async () => {
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    await screen.findByText("Cement");
    for (const stage of ["Draft", "Requested", "Ordered", "Received", "Closed"])
      expect(screen.getByRole("button", { name: new RegExp(stage) })).toBeInTheDocument();
  });

  it("renders pipeline stage counts and amount totals without colliding with the paginated list", async () => {
    routeFetch([
      row({ id: "draft-1", status: "draft", amount: 500, currency: "USD" }),
      row({ id: "ordered-1", status: "ordered", amount: 1200, currency: "USD" }),
      row({ id: "ordered-2", status: "ordered", amount: 300, currency: "USD" }),
    ]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    expect((await screen.findAllByText("Cement")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Draft1 500 USD Amount/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ordered2 1500 USD Amount/ })).toBeInTheDocument();

    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(url => url.includes("status=ordered") && url.includes("limit=1000"))).toBe(true);
    expect(urls.some(url => url.includes("page=1") && url.includes("limit=20"))).toBe(true);
  });

  it("toggles the status filter when a pipeline stage is clicked", async () => {
    const user = userEvent.setup();
    routeFetch([row()]);
    renderWithProviders(
      <ProjectProcurementTab projectId="p1" members={noMembers} userNames={new Map()} canManage={false} />,
    );
    const ordered = await screen.findByRole("button", { name: /Ordered/ });
    expect(ordered).toHaveAttribute("aria-pressed", "false");
    await user.click(ordered);
    expect(ordered).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => {
        const u = String(c[0]);
        return u.includes("status=ordered") && u.includes("limit=20");
      })).toBe(true);
    });
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
