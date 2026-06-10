import type { HrApprovalRow } from "@/shared/lib/api/hr-approvals";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { HrApprovalsPage } from "./-approvals-page";

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

function approval(overrides: Partial<HrApprovalRow> = {}): HrApprovalRow {
  return {
    id: "ap1",
    colleagueId: "fc1",
    type: "leave",
    title: "Annual leave",
    reason: null,
    status: "pending",
    decisionNote: null,
    decidedAt: null,
    decidedByName: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    applicant: { name: "Alice", username: "alice", isVirtual: false },
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

/** Route the approvals list GET, the colleague-picker GET, and mutations. */
function routeFetch(rows: readonly HrApprovalRow[]) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.includes("/hr/colleagues"))
      return jsonResponse({ success: true, data: colleagues, meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    if (method === "GET" && path.includes("/hr/approvals"))
      return jsonResponse({ success: true, data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });
    if (method === "POST" && path.endsWith("/decision"))
      return jsonResponse({ success: true, data: approval({ status: "approved", decidedByName: "Admin" }) });
    if (method === "POST")
      return jsonResponse({ success: true, data: approval({ id: "ap2" }) }, { status: 201 });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: approval({ title: "Sick leave" }) });
    if (method === "DELETE")
      return jsonResponse({ success: true });
    return jsonResponse({ success: true, data: null });
  });
}

describe("hrApprovalsPage", () => {
  it("shows the empty state when there are no requests", async () => {
    routeFetch([]);
    renderWithProviders(<HrApprovalsPage />);
    expect(await screen.findByText("No approval requests found.")).toBeInTheDocument();
  });

  it("renders a pending request with its actions", async () => {
    routeFetch([approval()]);
    renderWithProviders(<HrApprovalsPage />);
    expect(await screen.findByText("Annual leave")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("hides actions on a decided request and shows the decider", async () => {
    routeFetch([approval({
      status: "rejected",
      decidedByName: "Admin",
      decisionNote: "No budget",
      decidedAt: "2026-06-10T01:00:00.000Z",
    })]);
    renderWithProviders(<HrApprovalsPage />);
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("No budget")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("creates a request for a selected colleague", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrApprovalsPage />);
    await screen.findByText("No approval requests found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    // First combobox is the applicant picker, second the type select.
    await user.click(within(dialog).getAllByRole("combobox")[0]!);
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Alice/ }));
    await user.type(within(dialog).getByLabelText("Title"), "Annual leave");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/hr/approvals");
      expect(JSON.parse(String(post![1]?.body))).toEqual({ colleagueId: "fc1", type: "leave", title: "Annual leave" });
    });
  });

  it("approves a pending request through the decision dialog with a note", async () => {
    const user = userEvent.setup();
    routeFetch([approval()]);
    renderWithProviders(<HrApprovalsPage />);
    await screen.findByText("Annual leave");

    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Decision note (optional)"), "OK");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[0]).endsWith("/decision"));
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/hr/approvals/ap1/decision");
      expect(JSON.parse(String(post![1]?.body))).toEqual({ status: "approved", note: "OK" });
    });
  });

  it("withdraws a pending request after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([approval()]);
    renderWithProviders(<HrApprovalsPage />);
    await screen.findByText("Annual leave");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/hr/approvals/ap1");
    });
  });
});
