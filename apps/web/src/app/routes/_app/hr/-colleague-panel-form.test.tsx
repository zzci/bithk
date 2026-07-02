import type { ColleaguePanelProps } from "./-colleague-panel-shared";
import type { HrColleagueRow } from "@/shared/lib/api/hr";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ColleaguePanelForm } from "./-colleague-panel-form";

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

function colleague(): HrColleagueRow {
  return {
    id: "c1",
    userId: "u1",
    code: "E-01",
    title: "Engineer",
    department: "Deck",
    status: "active",
    notes: null,
    birthday: null,
    hireDate: null,
    probationEndDate: null,
    contractEndDate: null,
    gender: "male",
    employmentType: "full_time",
    nationality: null,
    personalPhone: null,
    personalEmail: null,
    address: null,
    workLocation: null,
    salaryAmount: null,
    salaryCurrency: null,
    paymentInfo: [],
    emergencyContacts: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    user: { id: "u1", name: "Alice", username: "alice", isVirtual: false, status: "active" },
  } as HrColleagueRow;
}

function makeProps(overrides: Partial<ColleaguePanelProps> = {}): ColleaguePanelProps {
  return {
    mode: "create",
    colleague: null,
    users: [{ id: "u1", name: "Alice", username: "alice", isVirtual: false }],
    pending: false,
    errorMessage: null,
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("colleaguePanelForm", () => {
  it("keeps save disabled until a user is linked", async () => {
    renderWithProviders(<ColleaguePanelForm {...makeProps()} />);
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("seeds the edit form from the colleague row and shows enum labels from the static maps", async () => {
    renderWithProviders(<ColleaguePanelForm {...makeProps({ mode: "edit", colleague: colleague() })} />);

    expect(await screen.findByLabelText("Code")).toHaveValue("E-01");
    // Gender / employment selects render their current value via the label maps
    // (the value may render in both the trigger and the hidden option list).
    expect(screen.getAllByText("Male").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Full-time").length).toBeGreaterThan(0);
  });

  it("submits the seeded form on save", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<ColleaguePanelForm {...makeProps({ mode: "edit", colleague: colleague(), onSubmit })} />);

    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]![0]).toMatchObject({
        userId: "u1",
        code: "E-01",
        gender: "male",
        employmentType: "full_time",
      });
    });
  }, 15000);
});
