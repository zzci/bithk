import type { ProjectContactView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsContacts } from "./-project-settings-contacts";

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

function contact(overrides: Partial<ProjectContactView> = {}): ProjectContactView {
  return {
    id: "ct1",
    type: "supplier",
    name: "Acme Supply",
    contactPerson: "Jane",
    phone: "555-1000",
    email: null,
    address: null,
    taxId: null,
    rating: null,
    status: "active",
    note: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

/** Route the contacts GET plus any mutation by method. */
function routeFetch(contacts: ProjectContactView[]) {
  fetchMock.mockImplementation(async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET")
      return jsonResponse({ success: true, data: contacts });
    if (method === "POST")
      return jsonResponse({ success: true, data: contact({ id: "ct2", name: "New" }) });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: contact({ id: "ct1", name: "Renamed" }) });
    return jsonResponse({ success: true, data: null });
  });
}

describe("projectSettingsContacts", () => {
  it("shows the empty state when there are no contacts", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage={false} />);
    expect(await screen.findByText("No contacts yet.")).toBeInTheDocument();
  });

  it("renders a contact row with its type badge, contact person and status", async () => {
    routeFetch([contact()]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage={false} />);
    expect(await screen.findByText("Acme Supply")).toBeInTheDocument();
    expect(screen.getByText("Supplier")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("555-1000")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("hides every management control when the viewer cannot manage", async () => {
    routeFetch([contact()]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage={false} />);
    await screen.findByText("Acme Supply");
    expect(screen.queryByRole("button", { name: "Add contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("creates a contact through the dialog and posts to the contacts endpoint", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage />);
    await screen.findByText("No contacts yet.");

    await user.click(screen.getByRole("button", { name: "Add contact" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Globex");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/projects/p1/contacts");
      const body = JSON.parse(String(post![1]?.body));
      expect(body.name).toBe("Globex");
      // Defaults flow through without touching the Selects.
      expect(body.type).toBe("supplier");
      expect(body.status).toBe("active");
    });
  });

  it("keeps the create submit disabled until a name is entered", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage />);
    await screen.findByText("No contacts yet.");
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Name"), "Globex");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("edits an existing contact and patches the specific contact id", async () => {
    const user = userEvent.setup();
    routeFetch([contact()]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage />);
    await screen.findByText("Acme Supply");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Acme Renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/projects/p1/contacts/ct1");
      expect(JSON.parse(String(patch![1]?.body)).name).toBe("Acme Renamed");
    });
  });

  it("deletes a contact after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([contact()]);
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage />);
    await screen.findByText("Acme Supply");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await user.click(confirm!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/projects/p1/contacts/ct1");
    });
  });

  it("surfaces a localized load error without leaking the server message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "internal: contacts table locked" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectSettingsContacts projectId="p1" canManage />);
    expect(await screen.findByText("Failed to load data")).toBeInTheDocument();
    expect(screen.queryByText(/internal: contacts table locked/)).not.toBeInTheDocument();
  });
});
