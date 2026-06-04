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
    website: null,
    position: "Manager",
    organizationId: "org-1",
    organizationName: "Acme Co",
    organization: { id: "org-1", name: "Acme Co", website: null, email: null, phone: null, address: null, taxId: null },
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

  it("shows individual details: kind, position, email and the linked company", () => {
    renderView(makeContact());

    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.test")).toBeInTheDocument();
    // The linked organization surfaces in the dedicated Company section.
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
  });

  it("renders the company info section and opens the org when its name is clicked", async () => {
    const onOpenOrganization = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ContactPanel
        mode="view"
        contact={makeContact({
          organization: {
            id: "org-9",
            name: "Acme HQ",
            website: "https://acme.test",
            email: "hq@acme.test",
            phone: "555",
            address: "Dock 1",
            taxId: "TAX-7",
          },
        })}
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
        onOpenOrganization={onOpenOrganization}
      />,
    );

    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("https://acme.test")).toBeInTheDocument();
    expect(screen.getByText("hq@acme.test")).toBeInTheDocument();
    expect(screen.getByText("TAX-7")).toBeInTheDocument();
    expect(screen.getByText("Dock 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acme HQ" }));
    expect(onOpenOrganization).toHaveBeenCalledWith("org-9");
  });

  it("renders a single collapsed sensitivity badge, confidential replacing private", () => {
    renderView(makeContact({ visibility: "private", confidential: true }));

    expect(screen.getByText("Sensitivity")).toBeInTheDocument();
    expect(screen.getByText("Confidential")).toBeInTheDocument();
    // The private label never co-displays alongside the confidential badge.
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("shows organization details: tax id and address", () => {
    renderView(makeContact({
      kind: "organization",
      name: "Acme Yard",
      organization: null,
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
    // No Company section for organization rows.
    expect(screen.queryByText("Company")).not.toBeInTheDocument();
  });
});

describe("contactPanel (form) kind selector", () => {
  it("create: both kinds share contact fields; only individuals get the person-only ones", async () => {
    const user = userEvent.setup();
    renderForm("create", null);

    // Individual default: shared fields plus the person-only position.
    expect(screen.getByRole("radio", { name: "Individual" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Website")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Position")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Organization" }));

    // Shared fields persist across kinds; the person-only position drops.
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Website")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();
  });

  it("edit: the kind is read-only (no radios)", () => {
    renderForm("edit", makeContact({ kind: "organization", name: "Acme Yard" }));

    expect(screen.queryByRole("radio", { name: "Individual" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
  });
});

describe("contactPanel (form) sensitivity control", () => {
  it("create: a single sensitivity control replaces the visibility select and confidential switch", () => {
    renderForm("create", null);

    expect(screen.getByText("Sensitivity")).toBeInTheDocument();
    // The standalone confidential toggle and the separate visibility field are gone.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Visibility")).not.toBeInTheDocument();
  });

  it("create: submits the default private sensitivity in form state", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm("create", null, { onSubmit });

    await user.type(screen.getByLabelText("Name"), "Beta Yard");
    // Create now requires a phone or email; provide one so submit is enabled.
    await user.type(screen.getByLabelText("Email"), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const state = onSubmit.mock.calls[0]![0] as ContactFormState;
    expect(state.sensitivity).toBe("private");
  });

  it("edit: seeds the sensitivity control from a confidential contact", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm("edit", makeContact({ visibility: "private", confidential: true }), { onSubmit });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const state = onSubmit.mock.calls[0]![0] as ContactFormState;
    expect(state.sensitivity).toBe("confidential");
  });
});

describe("contactPanel (form) custom attributes", () => {
  it("adds a row, captures it on submit, then removes it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm("create", null, { onSubmit });

    await user.type(screen.getByLabelText("Name"), "Jane Doe");
    // Create now requires a phone or email; provide one so submit is enabled.
    await user.type(screen.getByLabelText("Email"), "a@b.co");
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

const EMPTY_ORG_ATTRS = { website: "", email: "", phone: "", address: "", taxId: "" };

function OrgHarness() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationAttributes, setOrganizationAttributes] = useState(EMPTY_ORG_ATTRS);
  return (
    <>
      <ContactOrgCombobox
        organizationId={organizationId}
        organizationName={organizationName}
        organizationAttributes={organizationAttributes}
        onOrganizationAttributesChange={setOrganizationAttributes}
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

  it("creates a new organization from the typed name and exposes its company seed fields", async () => {
    routeOrgs([]);
    const user = userEvent.setup();
    renderWithProviders(<OrgHarness />);

    await user.click(screen.getByRole("combobox"));
    await user.type(await screen.findByPlaceholderText("Search organizations…"), "Beta Yard");
    await user.click(await screen.findByRole("option", { name: "Create \"Beta Yard\"" }));

    expect(screen.getByTestId("orgId")).toHaveTextContent("");
    expect(screen.getByTestId("orgName")).toHaveTextContent("Beta Yard");
    // A new org exposes optional company seed inputs; typing into one persists.
    const website = screen.getByLabelText("Website");
    await user.type(website, "https://beta.test");
    expect(website).toHaveValue("https://beta.test");
  });

  it("hides the company seed fields when an existing org is picked", async () => {
    routeOrgs([orgContact("org-1", "Acme Co")]);
    const user = userEvent.setup();
    renderWithProviders(<OrgHarness />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Acme Co" }));

    expect(screen.getByTestId("orgId")).toHaveTextContent("org-1");
    expect(screen.queryByLabelText("Website")).not.toBeInTheDocument();
  });
});
