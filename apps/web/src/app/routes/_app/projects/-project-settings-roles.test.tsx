import type { ProjectRoleView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsRoles } from "./-project-settings-roles";

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

function role(overrides: Partial<ProjectRoleView> = {}): ProjectRoleView {
  return {
    id: "r1",
    name: "Engineer",
    isSystem: false,
    capabilities: ["procurement.view"],
    ...overrides,
  } as ProjectRoleView;
}

/** Route fetch by method so a single render exercises GET + mutations. */
function routeFetch(roles: ProjectRoleView[]) {
  fetchMock.mockImplementation(async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET")
      return jsonResponse({ success: true, data: roles });
    if (method === "POST")
      return jsonResponse({ success: true, data: role({ id: "r2", name: "New" }) });
    return jsonResponse({ success: true, data: null });
  });
}

describe("projectSettingsRoles", () => {
  it("shows the empty state when no roles exist", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage={false} />);
    expect(await screen.findByText("No roles defined.")).toBeInTheDocument();
  });

  it("renders each role with its capability badges and a system marker", async () => {
    routeFetch([
      role({ id: "r1", name: "Engineer", capabilities: ["procurement.view"] }),
      role({ id: "sys", name: "Owner", isSystem: true, capabilities: [] }),
    ]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    expect(await screen.findByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText("View procurement")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("No capabilities")).toBeInTheDocument();
  });

  it("hides management controls when the viewer cannot manage", async () => {
    routeFetch([role()]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage={false} />);
    await screen.findByText("Engineer");
    expect(screen.queryByRole("button", { name: "Add role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("does not offer edit/delete for system roles", async () => {
    routeFetch([role({ id: "sys", name: "Owner", isSystem: true, capabilities: [] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("Owner");
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("creates a role through the dialog", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Reviewer");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/projects/p1/roles");
      expect(JSON.parse(String(post![1]?.body)).name).toBe("Reviewer");
    });
  });

  it("deletes a role after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch([role({ id: "r1", name: "Engineer" })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("Engineer");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.getByRole("dialog"));
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await user.click(confirm!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/projects/p1/roles/r1");
    });
  });

  it("surfaces a load error with a safe localized fallback (no server message leak)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "internal: row 42 denied" } },
      { status: 403 },
    ));
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    // Coded API errors must surface the localized fallback, never the raw
    // server message, so internals never leak into the UI.
    expect(await screen.findByText("Failed to load data")).toBeInTheDocument();
    expect(screen.queryByText(/internal: row 42/)).not.toBeInTheDocument();
  });
});
