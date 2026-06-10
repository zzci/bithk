import type { FinanceColleagueRow } from "@/shared/lib/api/finance";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { FinanceColleaguesPage } from "./-colleagues-page";

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

function colleague(overrides: Partial<FinanceColleagueRow> = {}): FinanceColleagueRow {
  return {
    id: "fc1",
    userId: "u1",
    code: "F-001",
    title: "Accountant",
    department: "Finance",
    status: "active",
    notes: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    user: { name: "Alice", username: "alice", isVirtual: false, status: "active" },
    ...overrides,
  };
}

const assignableUsers = [
  { id: "u1", name: "Alice", username: "alice", isVirtual: false },
  { id: "u2", name: "Crew B", username: "crew-b", isVirtual: true },
];

/** Route the colleagues list GET, the assignable-users GET, and mutations. */
function routeFetch(rows: readonly FinanceColleagueRow[]) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.includes("/assignable-users"))
      return jsonResponse({ success: true, data: assignableUsers, meta: { total: assignableUsers.length, page: 1, limit: 50 } });
    if (method === "GET" && path.includes("/finance/colleagues"))
      return jsonResponse({ success: true, data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } });
    if (method === "POST")
      return jsonResponse({ success: true, data: colleague({ id: "fc2" }) }, { status: 201 });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: colleague({ title: "Lead" }) });
    if (method === "DELETE")
      return jsonResponse({ success: true, data: colleague({ status: "archived" }) });
    return jsonResponse({ success: true, data: null });
  });
}

describe("financeColleaguesPage", () => {
  it("shows the empty state when there are no colleagues", async () => {
    routeFetch([]);
    renderWithProviders(<FinanceColleaguesPage />);
    expect(await screen.findByText("No colleagues found.")).toBeInTheDocument();
  });

  it("renders a real colleague without the virtual badge", async () => {
    routeFetch([colleague()]);
    renderWithProviders(<FinanceColleaguesPage />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("F-001")).toBeInTheDocument();
    expect(screen.getByText("Accountant")).toBeInTheDocument();
    expect(screen.queryByText("Virtual")).not.toBeInTheDocument();
  });

  it("marks a colleague linked to a virtual user with the virtual badge", async () => {
    routeFetch([colleague({
      id: "fc2",
      userId: "u2",
      code: null,
      user: { name: "Crew B", username: "crew-b", isVirtual: true, status: "active" },
    })]);
    renderWithProviders(<FinanceColleaguesPage />);
    expect(await screen.findByText("Crew B")).toBeInTheDocument();
    expect(screen.getByText("Virtual")).toBeInTheDocument();
  });

  it("keeps the create submit disabled until a user is chosen", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("No colleagues found.");
    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers both real and virtual users in the picker and creates a virtual colleague", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("No colleagues found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByRole("option", { name: /Alice/ });
    const optionNames = within(listbox).getAllByRole("option").map(o => o.textContent ?? "");
    // Real user without badge, virtual user with the Virtual badge inline.
    expect(optionNames.some(n => n.includes("Alice (alice)") && !n.includes("Virtual"))).toBe(true);
    expect(optionNames.some(n => n.includes("Crew B (crew-b)") && n.includes("Virtual"))).toBe(true);

    await user.click(within(listbox).getByRole("option", { name: /Crew B/ }));
    await user.type(within(dialog).getByLabelText("Code"), "F-009");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/finance/colleagues");
      expect(JSON.parse(String(post![1]?.body))).toEqual({ userId: "u2", code: "F-009" });
    });
  });

  it("creates a colleague linked to a real user", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("No colleagues found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Alice/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]?.body))).toEqual({ userId: "u1" });
    });
  });

  it("edits a colleague and patches the specific id", async () => {
    const user = userEvent.setup();
    routeFetch([colleague()]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Lead");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/finance/colleagues/fc1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.title).toBe("Lead");
      // The pre-filled user link and status are preserved through the edit.
      expect(body.userId).toBe("u1");
      expect(body.status).toBe("active");
    });
  });

  it("archives a colleague after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([colleague()]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/finance/colleagues/fc1");
    });
  });

  it("hides the archive action for an already-archived colleague", async () => {
    routeFetch([colleague({ status: "archived" })]);
    renderWithProviders(<FinanceColleaguesPage />);
    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});
