import type { ColleaguePanelProps } from "./-colleague-panel-shared";
import type { HrPayrollRow } from "@/shared/lib/api/hr-payroll";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ColleaguePanel } from "./-colleague-panel";
import { ColleaguePayrollSection } from "./-colleague-payroll-section";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: [] }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function record(overrides: Partial<HrPayrollRow> = {}): HrPayrollRow {
  return {
    id: "pr1",
    colleagueId: "c1",
    period: "2026-06",
    baseSalary: 100000,
    bonus: 5000,
    deduction: 2000,
    currency: "USD",
    netAmount: 103000,
    status: "pending",
    paidAt: null,
    notes: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    colleague: { name: "Alice", username: "alice", isVirtual: false },
    ...overrides,
  };
}

/** Route the payroll list GET; everything else resolves to an empty envelope. */
function routePayroll(
  rows: readonly HrPayrollRow[],
  totals: readonly { currency: string; net: number }[] = [],
  total = rows.length,
) {
  fetchMock.mockImplementation(async (url) => {
    const path = String(url);
    if (path.includes("/hr/payroll"))
      return jsonResponse({ success: true, data: rows, meta: { total, page: 1, limit: 12, totalPages: 1, totals } });
    return jsonResponse({ success: true, data: [] });
  });
}

describe("colleaguePayrollSection", () => {
  it("renders the colleague's payroll rows with amounts, status, and paid-at", async () => {
    routePayroll([
      record(),
      record({
        id: "pr2",
        period: "2026-05",
        status: "paid",
        paidAt: "2026-06-01T08:00:00.000Z",
      }),
    ]);
    renderWithProviders(<ColleaguePayrollSection colleagueId="c1" />);

    expect(await screen.findByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("Payroll history")).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
    // Base / net of the pending row, minor-unit integers formatted as money.
    expect(screen.getAllByText("1,000.00 USD").length).toBe(2);
    expect(screen.getAllByText("1,030.00 USD").length).toBe(2);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    // The list request is scoped to the colleague and capped at 12 rows.
    const listCall = fetchMock.mock.calls.find(c => String(c[0]).includes("/hr/payroll"));
    expect(String(listCall![0])).toContain("colleagueId=c1");
    expect(String(listCall![0])).toContain("limit=12");
  });

  it("renders one server-computed net total per currency", async () => {
    routePayroll(
      [record(), record({ id: "pr2", period: "2026-05", currency: "CNY" })],
      [{ currency: "USD", net: 103000 }, { currency: "CNY", net: 250000 }],
    );
    renderWithProviders(<ColleaguePayrollSection colleagueId="c1" />);

    expect(await screen.findByText("Net total · USD")).toBeInTheDocument();
    expect(screen.getByText("Net total · CNY")).toBeInTheDocument();
    expect(screen.getByText("2,500.00 CNY")).toBeInTheDocument();
  });

  it("shows a count line when more records exist than the page shows", async () => {
    routePayroll([record()], [], 30);
    renderWithProviders(<ColleaguePayrollSection colleagueId="c1" />);
    expect(await screen.findByText("Showing 1 of 30 records")).toBeInTheDocument();
  });

  it("shows the empty state when the colleague has no records", async () => {
    routePayroll([]);
    renderWithProviders(<ColleaguePayrollSection colleagueId="c1" />);
    expect(await screen.findByText("No payroll records found.")).toBeInTheDocument();
  });

  it("does not request payroll while the panel is in create mode", async () => {
    const props: ColleaguePanelProps = {
      mode: "create",
      colleague: null,
      users: [{ id: "u1", name: "Alice", username: "alice", isVirtual: false }],
      pending: false,
      errorMessage: null,
      onClose: vi.fn(),
      onEdit: vi.fn(),
      onArchive: vi.fn(),
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    renderWithProviders(<ColleaguePanel {...props} />);

    await screen.findByRole("button", { name: "Save" });
    await waitFor(() => {
      const payrollCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes("/hr/payroll"));
      expect(payrollCalls).toHaveLength(0);
    });
  });
});
