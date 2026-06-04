import type { ContactFormState } from "./-contact-form-logic";
import type { ContactView } from "@/shared/lib/api/contacts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContactOrgCombobox } from "./-contact-org-combobox";
import { ContactPanel } from "./-contact-panel";

function makeContact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    kind: "individual",
    ownerId: "u1",
    name: "Jane Doe",
    phone: "123",
    email: "jane@acme.test",
    position: "Manager",
    organizationId: "org-1",
    organizationName: "Acme Co",
    taxId: null,
    address: null,
    note: null,
    attributes: null,
    avatarReferenceId: null,
    avatarUrl: null,
    categoryId: null,
    status: "active",
    visibility: "private",
    confidential: false,
    tags: [],
    canManage: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function noop() {}

function renderView(contact: ContactView) {
  return renderWithProviders(
    <ContactPanel
      mode="view"
      contact={contact}
      pending={false}
      errorMessage={null}
      lockedLabel="Masked field"
      hiddenLabel="Hidden"
      onClose={noop}
      onEdit={noop}
      onShare={noop}
      onDelete={noop}
      onRename={noop}
      onSubmit={noop}
      onCancel={noop}
    />,
  );
}

function renderForm(
  mode: "edit" | "create",
  contact: ContactView | null,
  spies: { onCancel?: () => void; onClose?: () => void; onSubmit?: (state: ContactFormState) => void } = {},
) {
  return renderWithProviders(
    <ContactPanel
      mode={mode}
      contact={contact}
      pending={false}
      errorMessage={null}
      lockedLabel="Masked field"
      hiddenLabel="Hidden"
      onClose={spies.onClose ?? noop}
      onEdit={noop}
      onShare={noop}
      onDelete={noop}
      onRename={noop}
      onSubmit={spies.onSubmit ?? noop}
      onCancel={spies.onCancel ?? noop}
    />,
  );
}

describe("contactPanel (view)", () => {
  it("renders the title and the edit/share/delete icon actions when manageable", () => {
    renderView(makeContact({ canManage: true }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share contact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("hides the manage actions when the contact is read-only", () => {
    renderView(makeContact({ canManage: false }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows individual details: kind, position, email and employer", () => {
    renderView(makeContact());

    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.test")).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
  });

  it("shows organization details: tax id and address", () => {
    renderView(makeContact({
      kind: "organization",
      name: "Acme Yard",
      taxId: "TAX-1",
      address: "Dock 9",
      attributes: { region: "EU" },
    }));

    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("TAX-1")).toBeInTheDocument();
    expect(screen.getByText("Dock 9")).toBeInTheDocument();
    // Custom attributes surface as label/value pairs.
    expect(screen.getByText("region")).toBeInTheDocument();
    expect(screen.getByText("EU")).toBeInTheDocument();
    // Person-only fields are absent.
    expect(screen.queryByText("Manager")).not.toBeInTheDocument();
  });
});

describe("contactPanel (form) kind selector", () => {
  it("create: switching kind toggles the section fields", async () => {
    const user = userEvent.setup();
    renderForm("create", null);

    // Individual is the default: employer + email fields are present.
    expect(screen.getByRole("radio", { name: "Individual" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tax ID")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Organization" }));

    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("edit: the kind is read-only (no radios)", () => {
    renderForm("edit", makeContact({ kind: "organization", name: "Acme Yard" }));

    expect(screen.queryByRole("radio", { name: "Individual" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
  });
});

describe("contactPanel (form) custom attributes", () => {
  it("adds a row, captures it on submit, then removes it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm("create", null, { onSubmit });

    await user.type(screen.getByLabelText("Name"), "Jane Doe");
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.type(screen.getByLabelText("Attribute name"), "role");
    await user.type(screen.getByLabelText("Attribute value"), "lead");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const state = onSubmit.mock.calls[0]![0] as ContactFormState;
    expect(state.attributes.map(r => [r.key, r.value])).toEqual([["role", "lead"]]);

    // Removing the row drops both inputs.
    await user.click(screen.getByRole("button", { name: "Remove attribute" }));
    expect(screen.queryByLabelText("Attribute name")).not.toBeInTheDocument();
  });
});

describe("contactPanel (form) cancel + close", () => {
  it("edit: cancel calls onCancel without closing the drawer", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderForm("edit", makeContact(), { onCancel, onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("create: header X calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderForm("create", null, { onCancel });

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── Organization pick-or-create combobox ──

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function orgContact(id: string, name: string): ContactView {
  return makeContact({ id, kind: "organization", name, organizationId: null, organizationName: null });
}

function OrgHarness() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  return (
    <>
      <ContactOrgCombobox
        organizationId={organizationId}
        organizationName={organizationName}
        onPick={(org) => {
          setOrganizationId(org.id);
          setOrganizationName(org.name);
        }}
        onCreate={(name) => {
          setOrganizationId(null);
          setOrganizationName(name);
        }}
        onClear={() => {
          setOrganizationId(null);
          setOrganizationName("");
        }}
      />
      <output data-testid="orgId">{organizationId ?? ""}</output>
      <output data-testid="orgName">{organizationName}</output>
    </>
  );
}

describe("contactOrgCombobox", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => fetchMock.mockReset());

  function routeOrgs(orgs: ContactView[]) {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ success: true, data: orgs, meta: { total: orgs.length, page: 1, limit: 20 } }));
  }

  it("picks an existing organization and links it by id", async () => {
    routeOrgs([orgContact("org-1", "Acme Co")]);
    const user = userEvent.setup();
    renderWithProviders(<OrgHarness />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Acme Co" }));

    expect(screen.getByTestId("orgId")).toHaveTextContent("org-1");
    expect(screen.getByTestId("orgName")).toHaveTextContent("Acme Co");
  });

  it("creates a new organization from the typed name", async () => {
    routeOrgs([]);
    const user = userEvent.setup();
    renderWithProviders(<OrgHarness />);

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("Search organizations…"), "Beta Yard");
    await user.click(await screen.findByRole("option", { name: "Create \"Beta Yard\"" }));

    expect(screen.getByTestId("orgId")).toHaveTextContent("");
    expect(screen.getByTestId("orgName")).toHaveTextContent("Beta Yard");
  });
});
