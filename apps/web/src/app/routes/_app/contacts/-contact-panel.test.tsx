import type { ContactView } from "@/shared/lib/api/contacts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContactPanel } from "./-contact-panel";

function makeContact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    ownerId: "u1",
    name: "Acme Marine",
    contactPerson: "Jane",
    phone: "123",
    email: "jane@acme.test",
    address: null,
    taxId: null,
    note: null,
    status: "active",
    visibility: "private",
    confidential: false,
    categoryId: null,
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
  spies: { onCancel: () => void; onClose: () => void },
) {
  return renderWithProviders(
    <ContactPanel
      mode={mode}
      contact={contact}
      pending={false}
      errorMessage={null}
      lockedLabel="Masked field"
      hiddenLabel="Hidden"
      onClose={spies.onClose}
      onEdit={noop}
      onShare={noop}
      onDelete={noop}
      onRename={noop}
      onSubmit={noop}
      onCancel={spies.onCancel}
    />,
  );
}

describe("contactPanel (view) header migration", () => {
  it("renders the title and the edit/share/delete icon actions when manageable", () => {
    renderView(makeContact({ canManage: true }));

    expect(screen.getByText("Acme Marine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share contact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("hides the manage actions when the contact is read-only", () => {
    renderView(makeContact({ canManage: false }));

    expect(screen.getByText("Acme Marine")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("contactPanel (form) cancel", () => {
  it("edit mode: cancel calls onCancel without closing the drawer", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderForm("edit", makeContact(), { onCancel, onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("create mode: cancel calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    renderForm("create", null, { onCancel, onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
