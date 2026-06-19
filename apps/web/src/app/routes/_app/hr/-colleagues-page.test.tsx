import type { HrColleagueRow } from "@/shared/lib/api/hr";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { HrColleaguesPage } from "./-colleagues-page";

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

function colleague(overrides: Partial<HrColleagueRow> = {}): HrColleagueRow {
  return {
    id: "fc1",
    userId: "u1",
    code: "F-001",
    title: "Accountant",
    department: "Finance",
    status: "active",
    notes: null,
    birthday: null,
    hireDate: null,
    probationEndDate: null,
    contractEndDate: null,
    gender: null,
    employmentType: null,
    nationality: null,
    personalPhone: null,
    personalEmail: null,
    address: null,
    workLocation: null,
    salaryAmount: null,
    salaryCurrency: null,
    paymentInfo: [],
    emergencyContacts: [],
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

/** Route the colleagues list GET, attachments/limits GETs, assignable users, and mutations. */
function routeFetch(rows: readonly HrColleagueRow[]) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.includes("/assignable-users"))
      return jsonResponse({ success: true, data: assignableUsers, meta: { total: assignableUsers.length, page: 1, limit: 50 } });
    // Personal-document block (view mode) reads these — keep them empty so the
    // attachment grid renders nothing rather than mis-parsing colleague rows.
    if (method === "GET" && /\/hr\/colleagues\/[^/]+\/attachments/.test(path))
      return jsonResponse({ success: true, data: [] });
    if (method === "GET" && path.includes("/system/upload-limits"))
      return jsonResponse({ success: true, data: { maxFileSize: 10_485_760, maxAttachmentsPerResource: 20, totalQuota: null } });
    if (method === "GET" && path.includes("/hr/colleagues"))
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

/** Open the detail drawer for a colleague by clicking its name. */
async function openDrawer(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("hrColleaguesPage", () => {
  it("shows the empty state when there are no colleagues", async () => {
    routeFetch([]);
    renderWithProviders(<HrColleaguesPage />);
    expect(await screen.findByText("No colleagues found.")).toBeInTheDocument();
  });

  it("renders a real colleague without the virtual badge", async () => {
    routeFetch([colleague()]);
    renderWithProviders(<HrColleaguesPage />);
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
    renderWithProviders(<HrColleaguesPage />);
    expect(await screen.findByText("Crew B")).toBeInTheDocument();
    expect(screen.getByText("Virtual")).toBeInTheDocument();
  });

  it("keeps the create submit disabled until a user is chosen", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("No colleagues found.");
    await user.click(screen.getByRole("button", { name: "New" }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers both real and virtual users in the picker and creates a virtual colleague", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("No colleagues found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "User" }));
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByRole("option", { name: /Alice/ });
    const optionNames = within(listbox).getAllByRole("option").map(o => o.textContent ?? "");
    expect(optionNames.some(n => n.includes("Alice (alice)") && !n.includes("Virtual"))).toBe(true);
    expect(optionNames.some(n => n.includes("Crew B (crew-b)") && n.includes("Virtual"))).toBe(true);

    await user.click(within(listbox).getByRole("option", { name: /Crew B/ }));
    await user.type(within(drawer).getByLabelText("Code"), "F-009");
    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/hr/colleagues");
      const body = JSON.parse(String(post![1]?.body));
      expect(body.userId).toBe("u2");
      expect(body.code).toBe("F-009");
    });
  });

  it("creates a colleague linked to a real user", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("No colleagues found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "User" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Alice/ }));
    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.userId).toBe("u1");
      // Omitting the salary fields is valid — they round-trip as explicit null.
      expect(body.salaryAmount).toBeNull();
      expect(body.salaryCurrency).toBeNull();
    });
  });

  it("creates a colleague with salary amount and currency", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("No colleagues found.");

    await user.click(screen.getByRole("button", { name: "New" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "User" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Alice/ }));

    await user.type(within(drawer).getByLabelText("Monthly salary"), "5000.00");
    await user.click(within(drawer).getByRole("combobox", { name: "Currency" }));
    const currencyList = await screen.findByRole("listbox");
    await user.click(await within(currencyList).findByRole("option", { name: "USD" }));

    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.salaryAmount).toBe(500000);
      expect(body.salaryCurrency).toBe("USD");
    });
  });

  it("prefills the salary fields on edit and round-trips them through the patch", async () => {
    const user = userEvent.setup();
    routeFetch([colleague({ salaryAmount: 320050, salaryCurrency: "EUR" })]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("Alice");

    const drawer = await openDrawer(user, /Alice/);
    await user.click(within(drawer).getByRole("button", { name: "Edit" }));
    expect(within(drawer).getByLabelText("Monthly salary")).toHaveValue(3200.5);
    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.salaryAmount).toBe(320050);
      expect(body.salaryCurrency).toBe("EUR");
    });
  });

  it("edits a colleague from the drawer and patches the specific id", async () => {
    const user = userEvent.setup();
    routeFetch([colleague()]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("Alice");

    const drawer = await openDrawer(user, /Alice/);
    await user.click(within(drawer).getByRole("button", { name: "Edit" }));
    const title = within(drawer).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Lead");
    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/hr/colleagues/fc1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.title).toBe("Lead");
      // The pre-filled user link and status are preserved through the edit.
      expect(body.userId).toBe("u1");
      expect(body.status).toBe("active");
    });
  });

  it("archives a colleague from the drawer after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([colleague()]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("Alice");

    const drawer = await openDrawer(user, /Alice/);
    await user.click(within(drawer).getByRole("button", { name: "Archive" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/hr/colleagues/fc1");
    });
  });

  it("hides the archive action for an already-archived colleague", async () => {
    const user = userEvent.setup();
    routeFetch([colleague({ status: "archived" })]);
    renderWithProviders(<HrColleaguesPage />);
    await screen.findByText("Alice");

    const drawer = await openDrawer(user, /Alice/);
    expect(within(drawer).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});
