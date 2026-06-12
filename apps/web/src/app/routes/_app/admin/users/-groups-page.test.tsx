import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { GroupsTab } from "./groups.lazy";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// The group dialog renders several base-ui switches; driving them in jsdom
// under parallel CPU contention is slow.
vi.setConfig({ testTimeout: 20_000 });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

interface GroupFixture {
  id: string;
  name: string;
  description: string | null;
  modules: string[];
  memberCount: number;
  createdAt: string;
}

function group(overrides: Partial<GroupFixture> = {}): GroupFixture {
  return {
    id: "g1",
    name: "Engineering",
    description: "Engineers",
    modules: ["documents", "drive"],
    memberCount: 4,
    createdAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

interface UserFixture {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: string;
}

function user(overrides: Partial<UserFixture> = {}): UserFixture {
  return {
    id: "u1",
    username: "alan",
    name: "Alan",
    email: "alan@test.local",
    role: "user",
    status: "active",
    ...overrides,
  };
}

interface RouteData {
  groups?: GroupFixture[];
  adminUsers?: UserFixture[];
  membersByGroup?: Record<string, UserFixture[]>;
  searchUsers?: UserFixture[];
}

function routeFetch(data: RouteData) {
  const { groups = [], adminUsers = [], membersByGroup = {}, searchUsers = [] } = data;
  fetchMock.mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && u.startsWith("/api/account/users")) {
      const qs = new URLSearchParams(u.split("?")[1] ?? "");
      const items = qs.get("role") === "admin" ? adminUsers : qs.get("q") ? searchUsers : [];
      return jsonResponse({ success: true, data: items, meta: { total: items.length } });
    }
    if (method === "GET" && /\/api\/account\/groups\/[^/]+\/members$/.test(u)) {
      const groupId = u.split("/").at(-2)!;
      return jsonResponse({ success: true, data: membersByGroup[groupId] ?? [] });
    }
    if (method === "GET" && u.startsWith("/api/account/groups"))
      return jsonResponse({ success: true, data: groups });
    if (method === "POST" && u.endsWith("/account/groups"))
      return jsonResponse({ success: true, data: group({ id: "g9" }) }, { status: 201 });
    return jsonResponse({ success: true, data: null });
  });
}

function mutationCall(method: string) {
  return fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === method);
}

describe("groupsTab (FEAT-032)", () => {
  it("renders the built-in Administrators entry with count and group rows with module grants", async () => {
    routeFetch({
      groups: [group()],
      adminUsers: [user({ id: "a1", role: "admin" }), user({ id: "a2", role: "admin" })],
    });
    renderWithProviders(<GroupsTab />);

    const adminsRow = (await screen.findByText("Administrators")).closest("[role=button]")!;
    await waitFor(() => expect(within(adminsRow as HTMLElement).getByText("2")).toBeInTheDocument());
    expect(within(adminsRow as HTMLElement).getByText("System")).toBeInTheDocument();

    const groupRow = screen.getByText("Engineering").closest("[role=button]")!;
    expect(within(groupRow as HTMLElement).getByText("4")).toBeInTheDocument();
    // Module grants summary line.
    expect(within(groupRow as HTMLElement).getByText("Documents · Drive")).toBeInTheDocument();
  });

  it("creates a group with module grants", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ groups: [] });
    renderWithProviders(<GroupsTab />);
    await screen.findByText("Administrators");

    await u.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText("Group Name"), "Crew");
    await u.click(within(dialog).getByRole("switch", { name: "Ships" }));
    await u.click(within(dialog).getByRole("button", { name: "New" }));

    await waitFor(() => {
      const post = mutationCall("POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/account/groups");
      const body = JSON.parse(String(post![1]?.body));
      expect(body.name).toBe("Crew");
      expect(body.modules).toEqual(["ships"]);
    });
  });

  it("edits a group's module grants via PATCH", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({ groups: [group()] });
    renderWithProviders(<GroupsTab />);
    await screen.findByText("Engineering");

    await u.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: "Documents" })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: "Ships" })).not.toBeChecked();

    await u.click(within(dialog).getByRole("switch", { name: "Drive" }));
    await u.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/groups/g1");
      expect(JSON.parse(String(patch![1]?.body)).modules).toEqual(["documents"]);
    });
  });

  it("selecting Administrators lists admins; adding promotes, removing demotes", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    routeFetch({
      adminUsers: [user({ id: "a1", name: "Root", role: "admin" })],
      searchUsers: [user({ id: "u7", name: "Tom" })],
    });
    renderWithProviders(<GroupsTab />);

    await u.click(await screen.findByText("Administrators"));
    expect(await screen.findByText("Root")).toBeInTheDocument();

    // Remove → demote via PATCH role:user.
    await u.click(screen.getByRole("button", { name: "Remove member" }));
    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/a1");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ role: "user" });
    });
    fetchMock.mockClear();
    routeFetch({
      adminUsers: [user({ id: "a1", name: "Root", role: "admin" })],
      searchUsers: [user({ id: "u7", name: "Tom" })],
    });

    // Add → promote via PATCH role:admin (300 ms debounce before search).
    // Two "New" buttons exist (create group, add member) — the member one is second.
    await u.click(screen.getAllByRole("button", { name: "New" })[1]!);
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByPlaceholderText("Search users..."), "to");
    await u.click(await within(dialog).findByText("Tom"));
    await waitFor(() => {
      const patch = mutationCall("PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/account/users/u7");
      expect(JSON.parse(String(patch![1]?.body))).toEqual({ role: "admin" });
    });
  });

  it("selecting a group lists its members and remove deletes the membership", async () => {
    const u = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch({
      groups: [group()],
      membersByGroup: { g1: [user({ id: "m1", name: "Nina" })] },
    });
    renderWithProviders(<GroupsTab />);

    await u.click(await screen.findByText("Engineering"));
    expect(await screen.findByText("Nina")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Remove member" }));
    await waitFor(() => {
      const del = mutationCall("DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/account/groups/g1/members/m1");
    });
  });

  it("the Administrators entry offers no edit or delete actions", async () => {
    routeFetch({ groups: [group()] });
    renderWithProviders(<GroupsTab />);
    const adminsRow = (await screen.findByText("Administrators")).closest("[role=button]")!;
    expect(within(adminsRow as HTMLElement).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(adminsRow as HTMLElement).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
