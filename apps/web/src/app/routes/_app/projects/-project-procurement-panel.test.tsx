import type { ProcurementRow } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";
import { ProjectProcurementPanel } from "./-project-procurement-panel";

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
  useAuthStore.setState({ user: { id: "u1", role: "admin" } as never, loading: false });
});

afterEach(() => {
  fetchMock.mockReset();
  useAuthStore.setState({ user: null, loading: false });
});

function procurement(overrides: Partial<ProcurementRow> = {}): ProcurementRow {
  return {
    id: "pr1",
    projectId: "p1",
    title: null,
    itemName: "Cement",
    status: "requested",
    supplierId: null,
    categoryId: null,
    assigneeMemberId: null,
    quantity: 10,
    amount: 500,
    currency: "USD",
    description: null,
    priority: "medium",
    dueDate: null,
    creatorId: "u1",
    tags: [],
    pinned: false,
    pinnedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** Route the procurement detail GET plus the ancillary lookups the panel fires. */
function routeFetch(row: ProcurementRow) {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET" && /\/procurements\/pr1$/.test(path))
      return jsonResponse({ success: true, data: row });
    if (method === "PATCH" && /\/procurements\/pr1$/.test(path))
      return jsonResponse({ success: true, data: { ...row, itemName: "Steel" } });
    // suppliers (contacts), categories, attachments, comments, limits — all empty.
    return jsonResponse({ success: true, data: [] });
  });
}

const noMembers: readonly ProjectMemberView[] = [];
const userNames = new Map([["u1", "Alice"]]);

describe("projectProcurementPanel", () => {
  it("renders the item name, status, priority and creator", async () => {
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Cement" })).toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders the cancelled status label when the record is cancelled", async () => {
    routeFetch(procurement({ status: "cancelled" }));
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("exposes cancelled as a status option for managers", async () => {
    const user = userEvent.setup();
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    await user.click(screen.getByLabelText("Change status"));
    expect(await screen.findByRole("option", { name: "Cancelled" })).toBeInTheDocument();
  });

  it("changes status through the dedicated status endpoint, not the PATCH", async () => {
    const user = userEvent.setup();
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    await user.click(screen.getByLabelText("Change status"));
    await user.click(await screen.findByRole("option", { name: "Cancelled" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "POST");
      expect(post).toBeDefined();
      expect(String(post![0])).toContain("/projects/p1/procurements/pr1/status");
      expect(JSON.parse(String(post![1]?.body))).toEqual({ status: "cancelled" });
    });
  });

  it("patches the item name through inline title editing", async () => {
    const user = userEvent.setup();
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("heading", { name: "Cement" }));
    const input = screen.getByDisplayValue("Cement");
    await user.clear(input);
    await user.type(input, "Steel{Enter}");
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "PATCH");
      expect(patch).toBeDefined();
      expect(String(patch![0])).toContain("/projects/p1/procurements/pr1");
      expect(JSON.parse(String(patch![1]?.body))).toMatchObject({ itemName: "Steel" });
    });
  });

  it("renders a read-only view for non-managers", async () => {
    useAuthStore.setState({ user: { id: "u2", role: "user" } as never, loading: false });
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage={false}
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    // No editable status control, so the change-status affordance is absent.
    expect(screen.queryByLabelText("Change status")).not.toBeInTheDocument();
  });

  it("renders the fullscreen variant with a back-to-list action", async () => {
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="fullscreen"
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Cement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to list/i })).toBeInTheDocument();
  });

  it("patches a procurement field (quantity) through inline editing", async () => {
    const user = userEvent.setup();
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    // Quantity renders as an inline "10" affordance; click reveals the editor.
    await user.click(screen.getByRole("button", { name: "10" }));
    const input = screen.getByDisplayValue("10");
    await user.clear(input);
    await user.type(input, "25");
    await user.tab(); // blur commits the inline edit
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => String(c[1]?.method ?? "").toUpperCase() === "PATCH");
      expect(patch).toBeDefined();
      expect(String(patch![0])).toContain("/projects/p1/procurements/pr1");
      expect(JSON.parse(String(patch![1]?.body))).toMatchObject({ quantity: 25 });
    });
  });

  it("renders no delete control (procurement is non-deletable)", async () => {
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("renders the comments and attachments footer sections", async () => {
    routeFetch(procurement());
    renderWithProviders(
      <ProjectProcurementPanel
        projectId="p1"
        procurementId="pr1"
        members={noMembers}
        userNames={userNames}
        canManage
        variant="drawer"
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Cement" });
    // Comments section renders from ResourceFooterSections; the attachment
    // upload affordance is present for managers.
    expect(await screen.findByText("Comments")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /upload/i }).length).toBeGreaterThan(0);
  });
});
