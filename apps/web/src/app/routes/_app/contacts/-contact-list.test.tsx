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

describe("contactsListPage", () => {
  it("renders contacts with fields, tags, and manage actions", async () => {
    fetchMock.mockResolvedValue(ok([contact()]));

    renderWithProviders(<ContactsListPage />);

    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Company / unit" })).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("supplier")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Acme Marine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share Acme Marine" })).toBeInTheDocument();
  });

  it("renders the status and visibility filter chips with counts", async () => {
    fetchMock.mockResolvedValue(ok([
      contact(),
      contact({ id: "c2", name: "Beta Yard", status: "inactive", visibility: "public", confidential: true }),
    ]));

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Beta Yard")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Active 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Public 1" })).toBeInTheDocument();
  });

  it("hides manage actions when canManage is false", async () => {
    fetchMock.mockResolvedValue(ok([contact({ canManage: false })]));

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit Acme Marine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Acme Marine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share Acme Marine" })).not.toBeInTheDocument();
  });

  it("renders locked placeholders for masked confidential public reads in the table", async () => {
    fetchMock.mockResolvedValue(ok([
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
    ]));

    renderWithProviders(<ContactsListPage />);

    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    // The dense table surfaces four sensitive columns; all must be locked.
    expect(screen.getAllByLabelText("Masked field")).toHaveLength(4);
    expect(screen.queryByText("Jane")).not.toBeInTheDocument();
    expect(screen.queryByText("jane@example.com")).not.toBeInTheDocument();
  });

  it("keeps every sensitive field locked inside the detail drawer for masked reads", async () => {
    fetchMock.mockResolvedValue(ok([
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
    ]));
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getAllByLabelText("Masked field")).toHaveLength(7);
    expect(within(drawer).queryByText("Dock 1")).not.toBeInTheDocument();
  });

  it("opens a detail drawer that reuses the loaded contact data", async () => {
    fetchMock.mockResolvedValue(ok([contact()]));
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Acme Marine")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Acme Marine" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Dock 1")).toBeInTheDocument();
    expect(within(drawer).getByText("Preferred")).toBeInTheDocument();
    expect(within(drawer).getByText("Contact methods")).toBeInTheDocument();
  });

  it("filters client-side by status", async () => {
    fetchMock.mockResolvedValue(ok([
      contact(),
      contact({ id: "c2", name: "Beta Yard", status: "inactive" }),
    ]));
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Beta Yard")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Inactive 1" }));

    expect(screen.queryByText("Acme Marine")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Yard")).toBeInTheDocument();
  });

  it("filters client-side by search query", async () => {
    fetchMock.mockResolvedValue(ok([
      contact(),
      contact({ id: "c2", name: "Beta Yard", contactPerson: "Bob" }),
    ]));
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await waitFor(() => expect(screen.getByText("Beta Yard")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search company, person, or note"), "Beta");

    await waitFor(() => expect(screen.queryByText("Acme Marine")).not.toBeInTheDocument());
    expect(screen.getByText("Beta Yard")).toBeInTheDocument();
  });

  it("refetches with a tag filter", async () => {
    fetchMock.mockResolvedValue(ok([contact()]));
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
    fetchMock.mockResolvedValue(ok([]));
    const user = userEvent.setup();

    renderWithProviders(<ContactsListPage />);
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Contact methods" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Access and tags" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Type")).not.toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([contact()]))
      .mockResolvedValueOnce(ok({ id: "c1" }))
      .mockResolvedValue(ok([]));
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
});
