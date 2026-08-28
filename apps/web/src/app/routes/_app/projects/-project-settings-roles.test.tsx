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

// The inline editor renders many base-ui radios/switches; driving them through
// the dropdown is slow in jsdom and can exceed the 5s default under parallel
// CPU contention. Give the whole file generous headroom.
vi.setConfig({ testTimeout: 20_000 });

// Every default-preset project mounts these three, so the editor offers the
// full capability set unless a test opts into a narrower mount list.
const GENERAL_SECTIONS = ["issues", "procurement", "files"] as const;

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

type User = ReturnType<typeof userEvent.setup>;

/**
 * The access-level radios of one capability group. The table is grouped by
 * section now (a heading row, then the group's rows), so the radios are found
 * by the group's own accessible name rather than by walking table rows.
 */
function tierGroup(group: string): HTMLElement {
  return screen.getByRole("radiogroup", { name: group });
}

/** Open the role selector dropdown and load the named role into the editor. */
async function pickRole(user: User, name: string | RegExp) {
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
}

describe("projectSettingsRoles", () => {
  it("shows the empty state when no roles exist and the viewer cannot manage", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage={false} />);
    expect(await screen.findByText("No roles defined.")).toBeInTheDocument();
  });

  it("defaults to the inline create editor when the viewer can manage", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    // The editor is rendered in-page (no modal): the Name field and the module
    // permission rows are present immediately.
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("Work orders")).toBeInTheDocument();
    expect(screen.getByText("Procurement")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    // Create mode shows an Add action, not a dialog.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides write controls when the viewer cannot manage", async () => {
    routeFetch([role()]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage={false} />);
    // The first role loads read-only by default.
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows a selected system role read-only with no save/delete", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "sys", name: "Project Manager", isSystem: true, kind: "owner", capabilities: ["project.manage"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await screen.findByLabelText("Name");

    // System roles surface under their canonical label, never their stored name.
    await pickRole(user, "Project Owner");

    expect(screen.getByText("System")).toBeInTheDocument();
    // The stored name is never shown; the canonical label is used instead.
    expect(screen.queryByText("Project Manager")).not.toBeInTheDocument();
    // Read-only: no write actions, and the name field is disabled.
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("creates a role through the inline editor", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);

    await user.type(await screen.findByLabelText("Name"), "Reviewer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/projects/p1/roles");
      expect(JSON.parse(String(post![1]?.body)).name).toBe("Reviewer");
    });
  });

  it("selecting issue=View tier produces [issue.view] caps on submit", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Reviewer");

    // All modules default to "None". Click "View" in the Work orders row.
    const issueRow = tierGroup("Work orders");
    await user.click(within(issueRow).getByText("View"));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view"]);
    });
  });

  it("selecting issue=Manage tier produces cumulative [issue.view, issue.comment, issue.manage]", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Admin");

    const issueRow = tierGroup("Work orders");
    await user.click(within(issueRow).getByText("Manage"));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view", "issue.comment", "issue.manage"]);
    });
  });

  it("hides the capability group of a section the project has not mounted", async () => {
    routeFetch([]);
    // A ship-only project: procurement and files are absent.
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={["issues"]} canManage />);
    await screen.findByLabelText("Name");

    expect(screen.getByRole("radiogroup", { name: "Work orders" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Procurement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Files" })).not.toBeInTheDocument();
    // categories.manage belongs to procurement, so it goes with it.
    expect(screen.queryByRole("switch", { name: "Manage categories" })).not.toBeInTheDocument();
  });

  it("always offers the core capabilities, whatever the project mounts", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={[]} canManage />);
    await screen.findByLabelText("Name");

    expect(screen.getByRole("switch", { name: "Manage members" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Manage roles" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Manage project" })).toBeInTheDocument();
    // Nothing mounted, so no section group at all.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("keeps a hidden section's stored capabilities on save", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "r1", name: "Buyer", capabilities: ["issue.view", "procurement.view"] })]);
    // Procurement is not mounted, so its group is hidden — but a role that
    // already grants procurement.view must not be silently stripped.
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={["issues"]} canManage />);
    await screen.findByLabelText("Name");
    await pickRole(user, "Buyer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.capabilities).toEqual(["issue.view", "procurement.view"]);
    });
  });

  it("files module has no Comment tier option", async () => {
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await screen.findByLabelText("Name");

    const filesRow = tierGroup("Files");
    // Files row should have None, View, Manage but NOT Comment.
    expect(within(filesRow).getByText("None")).toBeInTheDocument();
    expect(within(filesRow).getByText("View")).toBeInTheDocument();
    expect(within(filesRow).getByText("Manage")).toBeInTheDocument();
    expect(within(filesRow).queryByText("Comment")).not.toBeInTheDocument();
  });

  it("loading a role with procurement.manage preselects Procurement=Manage tier", async () => {
    // A single role with canManage=false loads as the default selection, so the
    // derived tier is observable without opening the dropdown.
    routeFetch([role({ id: "r1", name: "Buyer", capabilities: ["procurement.view", "procurement.comment", "procurement.manage"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage={false} />);
    await screen.findByLabelText("Name");

    const procRow = tierGroup("Procurement");
    const manageRadio = within(procRow).getByText("Manage").closest("[data-slot='radio-group-item']");
    expect(manageRadio).toHaveAttribute("data-checked");
  });

  it("loading a role with only issue.view preselects Issue=View tier", async () => {
    routeFetch([role({ id: "r1", name: "Viewer", capabilities: ["issue.view"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage={false} />);
    await screen.findByLabelText("Name");

    const issueRow = tierGroup("Work orders");
    const viewRadio = within(issueRow).getByText("View").closest("[data-slot='radio-group-item']");
    expect(viewRadio).toHaveAttribute("data-checked");
  });

  it("admin toggles are independent from module tiers", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Admin");

    // Toggle project.manage and members.manage on.
    await user.click(screen.getByRole("switch", { name: "Manage project" }));
    await user.click(screen.getByRole("switch", { name: "Manage members" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      // No module tiers selected (all none), just admin caps.
      expect(body.capabilities).toEqual(["project.manage", "members.manage"]);
    });
  });

  it("reader preset sets all modules to View and no admin caps", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "ReadOnly");

    await user.click(screen.getByRole("button", { name: "Reader" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view", "procurement.view", "files.view"]);
    });
  });

  it("commenter preset sets issue=Comment, procurement=Comment, files=View", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Commenter");

    await user.click(screen.getByRole("button", { name: "Commenter" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual([
        "issue.view",
        "issue.comment",
        "procurement.view",
        "procurement.comment",
        "files.view",
      ]);
    });
  });

  it("writer preset sets all modules to Manage + categories.manage", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Writer");

    await user.click(screen.getByRole("button", { name: "Writer" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual([
        "issue.view",
        "issue.comment",
        "issue.manage",
        "procurement.view",
        "procurement.comment",
        "procurement.manage",
        "files.view",
        "files.manage",
        "categories.manage",
      ]);
    });
  });

  it("mixing module tiers independently (Issue=Manage, Procurement=View, Files=None)", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await user.type(await screen.findByLabelText("Name"), "Mixed");

    const issueRow = tierGroup("Work orders");
    await user.click(within(issueRow).getByText("Manage"));

    const procRow = tierGroup("Procurement");
    await user.click(within(procRow).getByText("View"));

    // Files stays None (default).

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual([
        "issue.view",
        "issue.comment",
        "issue.manage",
        "procurement.view",
      ]);
    });
  });

  it("updates a custom role loaded through the dropdown", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "r1", name: "Engineer", capabilities: ["issue.view"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await screen.findByLabelText("Name");

    await pickRole(user, "Engineer");
    // Edit mode exposes a Save action, not Add.
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/projects/p1/roles/r1");
    });
  });

  it("deletes a custom role after confirmation", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    routeFetch([role({ id: "r1", name: "Engineer" })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    await screen.findByLabelText("Name");

    await pickRole(user, "Engineer");
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
    renderWithProviders(<ProjectSettingsRoles projectId="p1" sections={GENERAL_SECTIONS} canManage />);
    // Coded API errors must surface the localized fallback, never the raw
    // server message, so internals never leak into the UI.
    expect(await screen.findByText("Failed to load data")).toBeInTheDocument();
    expect(screen.queryByText(/internal: row 42/)).not.toBeInTheDocument();
  });
});
