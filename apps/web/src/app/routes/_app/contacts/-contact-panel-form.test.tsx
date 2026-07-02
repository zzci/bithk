import type { ContactPanelProps } from "./-contact-panel-shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ContactPanelForm } from "./-contact-panel-form";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: [] }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function makeProps(overrides: Partial<ContactPanelProps> = {}): ContactPanelProps {
  return {
    mode: "create",
    contact: null,
    pending: false,
    errorMessage: null,
    lockedLabel: "Restricted",
    hiddenLabel: "Hidden",
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onShare: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("contactPanelForm", () => {
  it("renders the kind selector with labels from the static key map", async () => {
    renderWithProviders(<ContactPanelForm {...makeProps()} />);
    expect(await screen.findByRole("radio", { name: "Individual" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Organization" })).toBeInTheDocument();
  });

  it("keeps create disabled until a name and a contact method are present", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactPanelForm {...makeProps()} />);

    const submit = await screen.findByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "Alice");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Phone"), "555-0100");
    expect(submit).toBeEnabled();
  }, 15000);

  it("submits the filled form state", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ContactPanelForm {...makeProps({ onSubmit })} />);

    await user.type(await screen.findByLabelText("Name"), "Alice");
    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({
        kind: "individual",
        name: "Alice",
        email: "alice@example.com",
      });
    });
  }, 15000);

  it("cancels via the footer button", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<ContactPanelForm {...makeProps({ onCancel })} />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
