import type { GlobalRoleView } from "@/shared/lib/api/global-roles";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { GlobalRolesPage } from "./-roles-page";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// The inline editor renders several base-ui switches; driving them through
// the dropdown is slow in jsdom under parallel CPU contention.
vi.setConfig({ testTimeout: 20_000 });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function role(overrides: Partial<GlobalRoleView> = {}): GlobalRoleView {
  return {
    id: "r1",
    name: "Staff",
    modules: ["documents"],
    isSystem: false,
    kind: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

function defaultRole(overrides: Partial<GlobalRoleView> = {}): GlobalRoleView {
  return role({
    id: "sys",
    name: "Member",
    modules: ["documents", "drive", "projects", "ships", "contacts"],
    isSystem: true,
    kind: "default",
    ...overrides,
  });
}

/** Route fetch by method so a single render exercises GET + mutations. */
function routeFetch(roles: GlobalRoleView[]) {
  fetchMock.mockImplementation(async (_url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET")
      return jsonResponse({ success: true, data: roles });
    if (method === "POST")
      return jsonResponse({ success: true, data: role({ id: "r2", name: "New" }) }, { status: 201 });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: roles[0] ?? role() });
    return jsonResponse({ success: true, data: null });
  });
}

type User = ReturnType<typeof userEvent.setup>;

/** Open the role selector dropdown and load the named role into the editor. */
async function pickRole(user: User, name: string | RegExp) {
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
}

describe("globalRolesPage", () => {
  it("renders the role list and the inline create editor with all module rows", async () => {
    routeFetch([defaultRole(), role()]);
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderWithProviders(<GlobalRolesPage />);

    expect(await screen.findByText("Role Management")).toBeInTheDocument();
    // Create mode is the default selection: name field + one switch per module.
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    for (const label of ["Documents", "Drive", "Projects", "Ships", "Contacts", "HR"]) {
      expect(screen.getByRole("switch", { name: label })).toBeInTheDocument();
    }
    // Both fetched roles are offered in the dropdown.
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Staff" })).toBeInTheDocument();
  });

  it("creates a role with the toggled module set", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<GlobalRolesPage />);

    await user.type(await screen.findByLabelText("Name"), "Crew");
    await user.click(screen.getByRole("switch", { name: "Drive" }));
    await user.click(screen.getByRole("switch", { name: "Ships" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/global-roles");
      const body = JSON.parse(String(post![1]?.body));
      expect(body.name).toBe("Crew");
      expect(body.modules).toEqual(["drive", "ships"]);
    });
  });

  it("edits a role: toggling a module off persists via PATCH", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "r1", name: "Staff", modules: ["documents", "drive"] })]);
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByLabelText("Name");

    await pickRole(user, "Staff");
    // Stored modules preselect their switches.
    expect(screen.getByRole("switch", { name: "Documents" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Drive" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Ships" })).not.toBeChecked();

    await user.click(screen.getByRole("switch", { name: "Drive" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/global-roles/r1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.modules).toEqual(["documents"]);
    });
  });

  it("deletes a custom role after confirmation", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "r1", name: "Staff" })]);
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByLabelText("Name");

    await pickRole(user, "Staff");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog").catch(() => screen.getByRole("dialog"));
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await user.click(confirm!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/global-roles/r1");
    });
  });

  it("shows the system badge and disables delete for the default role, name stays editable", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([defaultRole()]);
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByLabelText("Name");

    await pickRole(user, "Member");

    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    // The default role's name and modules remain admin-editable.
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("surfaces a load error with a safe localized fallback", async () => {
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "FORBIDDEN", message: "internal: row 42 denied" } },
      { status: 403 },
    ));
    renderWithProviders(<GlobalRolesPage />);
    expect(await screen.findByText("Failed to load data")).toBeInTheDocument();
    expect(screen.queryByText(/internal: row 42/)).not.toBeInTheDocument();
  });
});
