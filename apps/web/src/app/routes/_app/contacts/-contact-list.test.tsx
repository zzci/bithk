import type { ContactView } from "@/shared/lib/api/contacts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContactsListPage } from "./index.lazy";

vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    ownerId: "u1",
    name: "Acme Marine",
    contactPerson: "Jane",
    phone: "123",
    email: "jane@example.com",
    address: "Dock 1",
    taxId: "TAX-1",
    note: "Preferred",
    status: "active",
    visibility: "private",
    confidential: false,
    categoryId: null,
    tags: [{ id: "t1", name: "supplier" }],
    canManage: true,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

function ok(data: unknown) {
  return jsonResponse({ success: true, data });
}

/**
 * Route the paginated list GET (returns the { data, meta } envelope the new
 * server-driven list expects) while letting mutations resolve generically.
 * `total` defaults to the row count so single-page tests need no override.
 */
function routeFetch(contacts: ContactView[], total = contacts.length) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    // The grid resolves category names through the global vocabulary query;
    // answer it with a fresh empty-list Response so it stays test-safe.
    if (path.includes("/contact-categories") && method === "GET") {
      return ok([]);
    }
    if (path.includes("/contacts") && method === "GET") {
      const parsed = new URL(path, "http://test.local");
      const page = Number(parsed.searchParams.get("page") ?? 1);
      const limit = Number(parsed.searchParams.get("limit") ?? 20);
      return jsonResponse({ success: true, data: contacts, meta: { total, page, limit } });
    }
    return ok({ id: "c1" });
  });
}

describe("contactsListPage", () => {
  it("renders contacts as dense grid rows with fields, tags, and manage actions", async () => {
    routeFetch([contact()]);

    renderWithProviders(<ContactsListPage />);

    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.getByText("Company / unit")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("supplier")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share Acme Marine" })).toBeInTheDocument();
  });

  it("renders the toolbar dropdown filters with their default labels", async () => {
    routeFetch([contact()]);

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "All statuses" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All visibility" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All confidentiality" })).toBeInTheDocument();
  });

  it("drives the list query from the status filter dropdown", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "All statuses" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Active" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("status=active"))).toBe(true);
    });
  });

  it("drives the list query from the confidential filter dropdown", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "All confidentiality" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Confidential" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("confidential=true"))).toBe(true);
    });
  });

  it("debounces the search box into the q query param", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search company, person, or note"), "Beta");

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("q=Beta"))).toBe(true);
    });
  });

  it("hides the hover-reveal manage actions when canManage is false", async () => {
    routeFetch([contact({ canManage: false })]);

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit Acme Marine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Acme Marine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Acme Marine" })).not.toBeInTheDocument();
  });

  it("renders locked placeholders for masked confidential public reads in the grid", async () => {
    routeFetch([
      contact({
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        taxId: null,
        note: null,
        status: null,
        visibility: "public",
        confidential: true,
        canManage: false,
      }),
    ]);

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    // The dense row surfaces four sensitive columns; all must be locked.
    expect(screen.getAllByLabelText("Masked field")).toHaveLength(4);
    expect(screen.queryByText("Jane")).not.toBeInTheDocument();
    expect(screen.queryByText("jane@example.com")).not.toBeInTheDocument();
  });

  it("keeps every sensitive field locked inside the detail drawer for masked reads", async () => {
    routeFetch([
      contact({
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        taxId: null,
        note: null,
        status: null,
        visibility: "public",
        confidential: true,
        canManage: false,
      }),
    ]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getAllByLabelText("Masked field")).toHaveLength(7);
    expect(within(drawer).queryByText("Dock 1")).not.toBeInTheDocument();
  });

  it("opens a detail drawer that reuses the loaded contact data", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Dock 1")).toBeInTheDocument();
    expect(within(drawer).getByText("Preferred")).toBeInTheDocument();
    expect(within(drawer).getByText("Contact methods")).toBeInTheDocument();
  });

  it("applies a single server-side tag filter to the query", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Tag filter"), "ship supplier");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      const filtered = fetchMock.mock.calls.find(c => String(c[0]).includes("tag=ship+supplier"));
      expect(filtered).toBeDefined();
    });
  });

  it("opens the current-schema form as sections without type controls", async () => {
    routeFetch([]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Contact methods" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Access and tags" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Type")).not.toBeInTheDocument();
  });

  it("opens the edit form from the row action", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit Acme Marine" }));

    expect(await screen.findByRole("heading", { name: "Edit contact" })).toBeInTheDocument();
  });

  it("opens the share dialog from the row action", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Share Acme Marine" }));

    expect(await screen.findByRole("heading", { name: "Share contact" })).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Delete Acme Marine" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await user.click(confirm);

    await waitFor(() => {
      const deleted = fetchMock.mock.calls.find(c => String(c[0]).endsWith("/api/contacts/c1") && c[1]?.method === "DELETE");
      expect(deleted).toBeDefined();
    });
  });

  it("renders meta-driven pagination and pages forward", async () => {
    // 25 total over a 20-row page -> two pages.
    routeFetch([contact()], 25);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());

    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getByText("25 contacts")).toBeInTheDocument();

    await user.click(next);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("page=2"))).toBe(true);
    });
  });
});
