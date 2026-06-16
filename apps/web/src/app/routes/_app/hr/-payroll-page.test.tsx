import type { HrPayrollRow } from "@/shared/lib/api/hr-payroll";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { HrPayrollPage } from "./-payroll-page";

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
  // Admin by default — payroll is an admin surface; the gate tests override
  // to a non-admin role to assert the gated actions disappear.
  useAuthStore.setState({ user: { role: "admin" } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: false });
});

function record(overrides: Partial<HrPayrollRow> = {}): HrPayrollRow {
  return {
    id: "pr1",
    colleagueId: "fc1",
    period: "2026-06",
    baseSalary: 100000,
    bonus: 5000,
    deduction: 2000,
    currency: "CNY",
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

const colleagues = [
  {
    id: "fc1",
    userId: "u1",
    code: null,
    title: null,
    department: null,
    status: "active",
    notes: null,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    user: { name: "Alice", username: "alice", isVirtual: false, status: "active" },
  },
];

/** Route the payroll list GET, the colleague-picker GET, and mutations. */
function routeFetch(
  rows: readonly HrPayrollRow[],
  totals: readonly { currency: string; net: number }[] = [],
) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.includes("/hr/colleagues"))
      return jsonResponse({ success: true, data: colleagues, meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    if (method === "POST" && path.includes("/hr/payroll/generate"))
      return jsonResponse({ success: true, data: { created: 3, skipped: 1 } });
    if (method === "GET" && path.includes("/hr/payroll"))
      return jsonResponse({ success: true, data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1, totals } });
    if (method === "POST")
      return jsonResponse({ success: true, data: record({ id: "pr2" }) }, { status: 201 });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: record({ status: "paid", paidAt: "2026-06-10T01:00:00.000Z" }) });
    if (method === "DELETE")
      return jsonResponse({ success: true });
    return jsonResponse({ success: true, data: null });
  });
}

describe("hrPayrollPage", () => {
  it("shows the empty state when there are no records", async () => {
    routeFetch([]);
    renderWithProviders(<HrPayrollPage />);
    expect(await screen.findByText("No payroll records found.")).toBeInTheDocument();
  });

  it("renders amounts with the record currency and a computed net", async () => {
    routeFetch([record({ currency: "USD" })]);
    renderWithProviders(<HrPayrollPage />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("2026-06")).toBeInTheDocument();
    expect(screen.getByText("100,000 USD")).toBeInTheDocument();
    expect(screen.getByText("103,000 USD")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("hides actions on a paid record", async () => {
    routeFetch([record({ status: "paid", paidAt: "2026-06-10T01:00:00.000Z" })]);
    renderWithProviders(<HrPayrollPage />);
    expect(await screen.findByText("Paid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark paid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a record with a chosen currency", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("No payroll records found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    // First combobox is the colleague picker, second the currency select.
    await user.click(within(dialog).getAllByRole("combobox")[0]!);
    let listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Alice/ }));

    await user.click(within(dialog).getAllByRole("combobox")[1]!);
    listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: "USD" }));

    // jsdom month inputs accept plain value typing.
    await user.type(within(dialog).getByLabelText("Period"), "2026-06");
    await user.type(within(dialog).getByLabelText("Base salary"), "100000");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/hr/payroll");
      expect(JSON.parse(String(post![1]?.body))).toEqual({
        colleagueId: "fc1",
        period: "2026-06",
        baseSalary: 100000,
        bonus: 0,
        deduction: 0,
        currency: "USD",
      });
    });
  });

  it("marks a pending record paid after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([record()]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Mark paid" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Mark paid" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/hr/payroll/pr1");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ status: "paid" });
    });
  });

  it("deletes a pending record after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([record()]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/hr/payroll/pr1");
    });
  });

  it("renders the per-currency net summary with thousands-separated money", async () => {
    routeFetch([record({ currency: "USD" })], [{ currency: "USD", net: 250000 }]);
    renderWithProviders(<HrPayrollPage />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    // Row money is grouped with thousands separators.
    expect(screen.getByText("100,000 USD")).toBeInTheDocument();
    // Summary row reflects meta.totals, also thousands-separated.
    expect(screen.getByText(/Net total/)).toBeInTheDocument();
    expect(screen.getByText("250,000 USD")).toBeInTheDocument();
  });

  it("renders the paid-at column", async () => {
    routeFetch([record({ status: "paid", paidAt: "2026-06-10T01:00:00.000Z" })]);
    renderWithProviders(<HrPayrollPage />);
    expect(await screen.findByText("Paid")).toBeInTheDocument();
    expect(screen.getByText("Paid at")).toBeInTheDocument();
  });

  it("hides the generate and mark-paid actions for a non-admin", async () => {
    useAuthStore.setState({ user: { role: "user" } as never, loading: false });
    routeFetch([record()]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: "Generate monthly payroll" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark paid" })).not.toBeInTheDocument();
    // Non-gated row actions stay available to HR-module users.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows the generate and mark-paid actions for an admin", async () => {
    routeFetch([record()]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("Alice");
    expect(screen.getByRole("button", { name: "Generate monthly payroll" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeInTheDocument();
  });

  it("generates monthly payroll for the chosen period", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrPayrollPage />);
    await screen.findByText("No payroll records found.");

    await user.click(screen.getByRole("button", { name: "Generate monthly payroll" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Month"), "2026-06");
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).includes("/hr/payroll/generate"));
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]?.body))).toEqual({ period: "2026-06" });
    });
  });
});
