import type { ContactCategory } from "@/shared/lib/api/contact-categories";
import type { ContactView } from "@/shared/lib/api/contacts";
import type { ProjectTag } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContactsListPage } from "./index.lazy";

vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    kind: "individual",
    ownerId: "u1",
    name: "Acme Marine",
    phone: "123",
    email: "jane@example.com",
    website: null,
    position: "Manager",
    organizationId: "org-1",
    organizationName: "Acme HQ",
    organization: { id: "org-1", name: "Acme HQ", website: null, email: null, phone: null, address: null, taxId: null },
    taxId: null,
    address: null,
    note: "Preferred",
    attributes: null,
    avatarReferenceId: null,
    avatarUrl: null,
    categoryId: null,
    status: "active",
    visibility: "private",
    confidential: false,
    tags: [{ id: "t1", name: "supplier" }],
    canManage: true,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

function category(overrides: Partial<ContactCategory> = {}): ContactCategory {
  return {
    id: "cat1",
    name: "Suppliers",
    code: null,
    description: null,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

function tag(overrides: Partial<ProjectTag> = {}): ProjectTag {
  return { id: "tag1", name: "ship supplier", usageCount: 3, ...overrides };
}

function ok(data: unknown) {
  return jsonResponse({ success: true, data });
}

/**
 * Route the paginated list GET (returns the { data, meta } envelope the
 * server-driven list expects) plus the category and tag vocabularies, while
 * letting mutations resolve generically. `total` defaults to the row count so
 * single-page tests need no override.
 */
function routeFetch(
  contacts: ContactView[],
  total = contacts.length,
  { categories = [], tags = [] }: { categories?: ContactCategory[]; tags?: ProjectTag[] } = {},
) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (path.includes("/contact-categories") && method === "GET") {
      return ok(categories);
    }
    if (path.includes("/tags") && method === "GET") {
      return ok(tags);
    }
    // An edit save (PATCH) returns the updated row; the panel re-renders it in
    // read-only view, so hand back a complete ContactView.
    if (path.includes("/contacts/") && method === "PATCH") {
      return ok(contacts[0] ?? contact());
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
  it("renders a person-primary grid row with avatar, name, employer, and manage actions", async () => {
    routeFetch([contact()]);

    renderWithProviders(<ContactsListPage />);

    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Acme HQ")).toBeInTheDocument();
    // Kind is shown as an accessible icon, not a text badge.
    expect(screen.getByRole("img", { name: "Individual" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share Acme Marine" })).toBeInTheDocument();
  });

  it("renders a single-row toolbar of kind, status, category, and tag filters", async () => {
    routeFetch([contact()], 1, { categories: [category()], tags: [tag()] });

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    // Each dimension renders its own dropdown trigger labelled by its name.
    expect(screen.getByRole("button", { name: "Kind" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tags" })).toBeInTheDocument();
  });

  it("drives the list query from the kind filter", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Kind" }));
    await user.click(await screen.findByRole("menuitem", { name: "Organization" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("kind=organization"))).toBe(true);
    });
  });

  it("drives the list query from the status filter", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("menuitem", { name: "Active" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("status=active"))).toBe(true);
    });
  });

  it("drives the list query from the category filter dropdown", async () => {
    routeFetch([contact()], 1, { categories: [category()] });
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Category" }));
    await user.click(await screen.findByRole("menuitem", { name: "Suppliers" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("categoryId=cat1"))).toBe(true);
    });
  });

  it("filters by a tag from the multi-select dropdown and shows a removable chip", async () => {
    routeFetch([contact()], 1, { tags: [tag()] });
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Tags" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "ship supplier" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).includes("tagIds=tag1"))).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Remove ship supplier" })).toBeInTheDocument();
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

  it("exposes no sensitive columns in the slimmed grid for masked confidential public reads", async () => {
    routeFetch([
      contact({
        phone: null,
        email: null,
        position: null,
        organizationName: null,
        note: null,
        status: null,
        visibility: "public",
        confidential: true,
        canManage: false,
      }),
    ]);

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    // The slimmed grid drops every sensitive column, so no masked placeholders appear.
    expect(screen.queryAllByLabelText("Masked field")).toHaveLength(0);
    expect(screen.queryByText("jane@example.com")).not.toBeInTheDocument();
  });

  it("keeps every sensitive field locked inside the detail drawer for masked reads", async () => {
    routeFetch([
      contact({
        phone: null,
        email: null,
        website: null,
        position: null,
        organizationName: null,
        organization: null,
        taxId: null,
        address: null,
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
    // The individual detail surfaces position, phone, email, website, tax id,
    // address plus the note — every shared field locked for a masked read.
    expect(within(drawer).getAllByLabelText("Masked field")).toHaveLength(7);
  });

  it("opens a detail drawer that reuses the loaded contact data", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Acme HQ")).toBeInTheDocument();
    expect(within(drawer).getByText("Preferred")).toBeInTheDocument();
    expect(within(drawer).getByText("Details")).toBeInTheDocument();
  });

  it("opens the create form in a sectioned drawer with a kind selector", async () => {
    routeFetch([]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await user.click(screen.getByRole("button", { name: "New" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Identity" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Classification" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Access" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Individual" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Organization" })).toBeInTheDocument();
  });

  it("opens the edit form from the row action", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit Acme Marine" }));

    expect(await screen.findByRole("heading", { name: "Edit contact" })).toBeInTheDocument();
  });

  it("switches from view to edit inside the same drawer", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: "Edit" }));

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

  it("saves an edit, toasts success, and returns to the contact view", async () => {
    routeFetch([contact()]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Edit Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { name: "Edit contact" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patched = fetchMock.mock.calls.find(c => String(c[0]).endsWith("/api/contacts/c1") && c[1]?.method === "PATCH");
      expect(patched).toBeDefined();
    });
    expect(toast.success).toHaveBeenCalledWith("Contact updated");
    await waitFor(() => expect(within(drawer).queryByRole("heading", { name: "Edit contact" })).not.toBeInTheDocument());
    expect(within(drawer).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("creates a contact, toasts success, and closes the drawer", async () => {
    routeFetch([]);
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await user.click(screen.getByRole("button", { name: "New" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Beta Yard");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const created = fetchMock.mock.calls.find(c => String(c[0]).endsWith("/api/contacts") && c[1]?.method === "POST");
      expect(created).toBeDefined();
    });
    expect(toast.success).toHaveBeenCalledWith("Contact created");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
