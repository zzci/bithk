import type { ProjectMemberView, ProjectRoleView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsMembers } from "./-project-settings-members";

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

function member(overrides: Partial<ProjectMemberView> = {}): ProjectMemberView {
  return {
    id: "m1",
    userId: "u1",
    name: "Alice",
    isVirtual: false,
    roleId: "r1",
    title: "Engineer",
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

const roles: ProjectRoleView[] = [
  { id: "r1", name: "Owner", capabilities: [], isSystem: true, kind: "owner", createdAt: "", updatedAt: "" },
  { id: "r2", name: "Worker", capabilities: [], isSystem: false, createdAt: "", updatedAt: "" },
  { id: "r3", name: "Guest", capabilities: [], isSystem: true, kind: "guest", createdAt: "", updatedAt: "" },
];

/** Route the roles GET, the assignable-users GET, and any member mutation. */
function routeFetch() {
  fetchMock.mockImplementation(async (url, init) => {
    const path = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && path.includes("/roles"))
      return jsonResponse({ success: true, data: roles });
    if (method === "GET" && path.includes("/assignable-users"))
      return jsonResponse({ success: true, data: [{ id: "u9", name: "Bob", username: "bob", isVirtual: false }], meta: { total: 1 } });
    if (method === "PATCH")
      return jsonResponse({ success: true, data: member({ title: "Lead" }) });
    if (method === "POST")
      return jsonResponse({ success: true, data: member({ id: "m2" }) });
    return jsonResponse({ success: true, data: null });
  });
}

const userNames = new Map([["u1", "Alice"]]);

describe("projectSettingsMembers", () => {
  it("shows the empty state when there are no members", async () => {
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[]} userNames={userNames} canManage={false} />,
    );
    expect(await screen.findByText("No members yet.")).toBeInTheDocument();
  });

  it("renders a real member with its resolved name, title and role name", async () => {
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[member()]} userNames={userNames} canManage={false} />,
    );
    // Role name resolves once the roles query settles. The system role (r1) is
    // presented as "Project Owner", not its stored name "Owner".
    expect(await screen.findByText("Project Owner")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Virtual")).not.toBeInTheDocument();
  });

  it("marks a virtual member with the virtual badge and its display name", async () => {
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers
        projectId="p1"
        members={[member({ id: "m2", userId: "u2", name: "Crew B", isVirtual: true, roleId: "r2", title: null })]}
        userNames={userNames}
        canManage={false}
      />,
    );
    expect(await screen.findByText("Crew B")).toBeInTheDocument();
    expect(screen.getByText("Virtual")).toBeInTheDocument();
    // Role name resolves once the roles query settles.
    expect(await screen.findByText("Worker")).toBeInTheDocument();
  });

  it("labels a member on the guest system role as Guest, not Project Owner", async () => {
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers
        projectId="p1"
        members={[member({ id: "m3", roleId: "r3" })]}
        userNames={userNames}
        canManage={false}
      />,
    );
    await screen.findByText("Alice");
    // The guest system role resolves via its `kind`, not the owner fallback.
    expect(await screen.findByText("Guest")).toBeInTheDocument();
    expect(screen.queryByText("Project Owner")).not.toBeInTheDocument();
  });

  it("hides management controls when the viewer cannot manage", async () => {
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[member()]} userNames={userNames} canManage={false} />,
    );
    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("keeps the add submit disabled until a role and target are chosen", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[]} userNames={userNames} canManage />,
    );
    await screen.findByText("No members yet.");
    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    // Neither role nor user selected yet → submit must stay disabled.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("excludes the Guest system role from the assignable role options", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[]} userNames={userNames} canManage />,
    );
    await screen.findByText("No members yet.");
    await user.click(screen.getByRole("button", { name: "New" }));
    const dialog = await screen.findByRole("dialog");
    // The role select is the last combobox in the dialog (after the user picker).
    const comboboxes = within(dialog).getAllByRole("combobox");
    await user.click(comboboxes[comboboxes.length - 1]!);
    const listbox = await screen.findByRole("listbox");
    // Wait for the roles query to settle and populate the options.
    await within(listbox).findByRole("option", { name: "Project Owner" });
    const optionNames = within(listbox).getAllByRole("option").map(o => o.textContent?.trim());
    // Owner + custom roles are assignable; the Guest system role is excluded.
    expect(optionNames).toContain("Project Owner");
    expect(optionNames).toContain("Worker");
    expect(optionNames).not.toContain("Guest");
  });

  it("edits a member's title and patches the specific member id", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[member()]} userNames={userNames} canManage />,
    );
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Lead");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/projects/p1/members/m1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.title).toBe("Lead");
      // Pre-filled role id is preserved through the edit.
      expect(body.roleId).toBe("r1");
    });
  });

  it("removes a member after confirmation", async () => {
    const user = userEvent.setup();
    routeFetch();
    renderWithProviders(
      <ProjectSettingsMembers projectId="p1" members={[member()]} userNames={userNames} canManage />,
    );
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getAllByRole("button").find(b => /delete/i.test(b.textContent ?? ""));
    await user.click(confirm!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/projects/p1/members/m1");
    });
  });
});
