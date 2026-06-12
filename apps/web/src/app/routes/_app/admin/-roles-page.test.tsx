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

// The permissions dialog renders several base-ui switches; driving them in
// jsdom under parallel CPU contention is slow.
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
    userCount: 1,
    ...overrides,
  };
}

function guestRole(overrides: Partial<GlobalRoleView> = {}): GlobalRoleView {
  return role({
    id: "sys",
    name: "Guest",
    modules: [],
    isSystem: true,
    kind: "default",
    userCount: 3,
    ...overrides,
  });
}

interface UserItem {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "user";
  globalRoleId: string | null;
}

function user(overrides: Partial<UserItem> = {}): UserItem {
  return {
    id: "u1",
    username: "alan",
    name: "Alan",
    email: "alan@test.local",
    role: "user",
    globalRoleId: null,
    ...overrides,
  };
}

interface RouteData {
  roles?: GlobalRoleView[];
  adminUsers?: UserItem[];
  membersByRole?: Record<string, UserItem[]>;
  searchUsers?: UserItem[];
}

/** Route fetch by method + URL so a single render exercises GET + mutations. */
function routeFetch(data: RouteData) {
  const { roles = [], adminUsers = [], membersByRole = {}, searchUsers = [] } = data;
  const list = (items: UserItem[]) =>
    jsonResponse({ success: true, data: items, meta: { total: items.length, page: 1, limit: 100 } });

  fetchMock.mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && u.startsWith("/api/global-roles"))
      return jsonResponse({ success: true, data: roles });
    if (method === "GET" && u.startsWith("/api/account/users")) {
      const qs = new URLSearchParams(u.split("?")[1] ?? "");
      if (qs.get("role") === "admin")
        return list(adminUsers);
      const roleId = qs.get("global_role_id");
      if (roleId)
        return list(membersByRole[roleId] ?? []);
      if (qs.get("q"))
        return list(searchUsers);
      return list([]);
    }
    if (method === "POST")
      return jsonResponse({ success: true, data: role({ id: "r2", name: "New" }) }, { status: 201 });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: {} });
    return jsonResponse({ success: true, data: null });
  });
}

function mutationCall(method: string) {
  return fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === method);
}

describe("globalRolesPage", () => {
  it("renders Admin/Guest/custom rows with member-count badges", async () => {
    routeFetch({
      roles: [guestRole(), role({ userCount: 5 })],
      adminUsers: [user({ id: "a1", role: "admin" }), user({ id: "a2", role: "admin" })],
    });
    renderWithProviders(<GlobalRolesPage />);

    expect(await screen.findByText("Role Management")).toBeInTheDocument();
    const adminRow = (await screen.findByText("Administrators")).closest("[role=button]")!;
    await waitFor(() => expect(within(adminRow as HTMLElement).getByText("2")).toBeInTheDocument());
    const guestRow = screen.getByText("Guest").closest("[role=button]")!;
    expect(within(guestRow as HTMLElement).getByText("3")).toBeInTheDocument();
    const staffRow = screen.getByText("Staff").closest("[role=button]")!;
    expect(within(staffRow as HTMLElement).getByText("5")).toBeInTheDocument();
  });

  it("edits a custom role's permissions in a dialog via PATCH", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ roles: [guestRole(), role({ modules: ["documents", "drive"] })] });
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByText("Staff");

    await u.click(screen.getByRole("button", { name: "Permissions of Staff" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: "Documents" })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: "Ships" })).not.toBeChecked();

    await u.click(within(dialog).getByRole("switch", { name: "Drive" }));
    await u.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/global-roles/r1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.modules).toEqual(["documents"]);
    });
  });

  it("shows Guest and Admin permissions read-only", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ roles: [guestRole()] });
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByText("Guest");

    await u.click(screen.getByRole("button", { name: "Permissions of Guest" }));
    let dialog = await screen.findByRole("dialog");
    // base-ui switches surface their locked state via `data-disabled`.
    expect(within(dialog).getByRole("switch", { name: "Documents" })).toHaveAttribute("data-disabled");
    expect(within(dialog).getByRole("switch", { name: "Documents" })).not.toBeChecked();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await u.keyboard("{Escape}");

    await u.click(screen.getByRole("button", { name: "Permissions of Administrators" }));
    dialog = await screen.findByRole("dialog");
    // Admin is full access: every switch on and locked.
    expect(within(dialog).getByRole("switch", { name: "HR" })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: "HR" })).toHaveAttribute("data-disabled");
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("creates a custom role from the New role dialog", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ roles: [guestRole()] });
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByText("Guest");

    await u.click(screen.getByRole("button", { name: "New role" }));
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText("Name"), "Crew");
    await u.click(within(dialog).getByRole("switch", { name: "Drive" }));
    await u.click(within(dialog).getByRole("switch", { name: "Ships" }));
    await u.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = mutationCall("POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/global-roles");
      const body = JSON.parse(String(post![1]?.body));
      expect(body.name).toBe("Crew");
      expect(body.modules).toEqual(["drive", "ships"]);
    });
  });

  it("deletes a custom role after confirmation; Guest has no delete action", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ roles: [guestRole(), role()] });
    renderWithProviders(<GlobalRolesPage />);
    await screen.findByText("Staff");

    // Exactly one delete action: the custom role's (Admin/Guest have none).
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    expect(deleteButtons).toHaveLength(1);
    await u.click(deleteButtons[0]!);

    const dialog = await screen.findByRole("alertdialog").catch(() => screen.getByRole("dialog"));
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await u.click(confirm!);

    await waitFor(() => {
      const del = mutationCall("DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/global-roles/r1");
    });
  });

  it("lists a role's members and removes one back to Guest", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({
      roles: [guestRole(), role()],
      membersByRole: { r1: [user({ id: "u9", name: "Nina", globalRoleId: "r1" })] },
    });
    renderWithProviders(<GlobalRolesPage />);

    await u.click(await screen.findByText("Staff"));
    expect(await screen.findByText("Nina")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /Remove/ }));
    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/u9");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ globalRoleId: null });
    });
  });

  it("adds a searched user to a custom role via PATCH globalRoleId", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    routeFetch({
      roles: [guestRole(), role()],
      searchUsers: [user({ id: "u7", name: "Tom" })],
    });
    renderWithProviders(<GlobalRolesPage />);

    await u.click(await screen.findByText("Staff"));
    await u.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByPlaceholderText(/Search by name/), "to");

    // 300 ms debounce before the search fires.
    await u.click(await within(dialog).findByText("Tom"));
    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/u7");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ globalRoleId: "r1" });
    });
  });

  it("promotes a searched user when adding to Administrators", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    routeFetch({
      roles: [guestRole()],
      searchUsers: [user({ id: "u7", name: "Tom" })],
    });
    renderWithProviders(<GlobalRolesPage />);

    await u.click(await screen.findByText("Administrators"));
    await u.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByPlaceholderText(/Search by name/), "to");

    await u.click(await within(dialog).findByText("Tom"));
    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/u7");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ role: "admin" });
    });
  });

  it("offers no add/remove membership controls for Guest (fallback bucket)", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({
      roles: [guestRole()],
      membersByRole: { sys: [user({ id: "u5", name: "Lou" })] },
    });
    renderWithProviders(<GlobalRolesPage />);

    await u.click(await screen.findByText("Guest"));
    expect(await screen.findByText("Lou")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
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
