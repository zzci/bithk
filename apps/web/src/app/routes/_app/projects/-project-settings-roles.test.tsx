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

  it("renders custom-role capability badges but hides them for the system owner role", async () => {
    routeFetch([
      role({ id: "r1", name: "Engineer", capabilities: ["procurement.view"] }),
      // Give the system role capabilities to prove they are still hidden.
      role({ id: "sys", name: "Project Manager", isSystem: true, capabilities: ["project.manage"] }),
    ]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    expect(await screen.findByText("Engineer")).toBeInTheDocument();
    // Custom roles keep their capability badge list.
    expect(screen.getByText("View procurement")).toBeInTheDocument();
    // The system role is always presented as "Project Owner", never its stored name.
    expect(screen.getByText("Project Owner")).toBeInTheDocument();
    expect(screen.queryByText("Project Manager")).not.toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    // The system owner role is capability-locked, so its capability badges and
    // the "No capabilities" placeholder are both suppressed.
    expect(screen.queryByText("Manage project")).not.toBeInTheDocument();
    expect(screen.queryByText("No capabilities")).not.toBeInTheDocument();
  });

  it("hides management controls when the viewer cannot manage", async () => {
    routeFetch([role()]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage={false} />);
    await screen.findByText("Engineer");
    expect(screen.queryByRole("button", { name: "Add role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("does not offer edit/delete for system roles", async () => {
    routeFetch([role({ id: "sys", name: "Project Manager", isSystem: true, capabilities: [] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("Project Owner");
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

  it("shows module radio group sections in the create dialog", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");

    // Module group headers rendered as fieldset legends.
    expect(within(dialog).getByText("Work orders")).toBeInTheDocument();
    expect(within(dialog).getByText("Procurement")).toBeInTheDocument();
    expect(within(dialog).getByText("Files")).toBeInTheDocument();
    // Administration section for non-tiered caps.
    expect(within(dialog).getByText("Administration")).toBeInTheDocument();
  });

  it("selecting issue=View tier produces [issue.view] caps on submit", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Reviewer");

    // All modules default to "None". Click "View" in the Work orders section.
    const issueSection = within(dialog).getByText("Work orders").closest("fieldset")!;
    await user.click(within(issueSection).getByText("View"));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view"]);
    });
  });

  it("selecting issue=Manage tier produces cumulative [issue.view, issue.comment, issue.manage]", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Admin");

    const issueSection = within(dialog).getByText("Work orders").closest("fieldset")!;
    await user.click(within(issueSection).getByText("Manage"));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view", "issue.comment", "issue.manage"]);
    });
  });

  it("files module has no Comment tier option", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");

    const filesSection = within(dialog).getByText("Files").closest("fieldset")!;
    // Files section should have None, View, Manage but NOT Comment.
    expect(within(filesSection).getByText("None")).toBeInTheDocument();
    expect(within(filesSection).getByText("View")).toBeInTheDocument();
    expect(within(filesSection).getByText("Manage")).toBeInTheDocument();
    expect(within(filesSection).queryByText("Comment")).not.toBeInTheDocument();
  });

  it("loading a role with procurement.manage preselects Procurement=Manage tier", async () => {
    const user = userEvent.setup();
    routeFetch([role({ id: "r1", name: "Buyer", capabilities: ["procurement.view", "procurement.comment", "procurement.manage"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("Buyer");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");

    const procSection = within(dialog).getByText("Procurement").closest("fieldset")!;
    // The "Manage" radio should be selected (checked).
    const manageRadio = within(procSection).getByText("Manage").closest("[data-slot='radio-group-item']");
    expect(manageRadio).toHaveAttribute("data-checked");
  });

  it("loading a role with only issue.view preselects Issue=View tier", async () => {
    const user = userEvent.setup();
    routeFetch([role({ id: "r1", name: "Viewer", capabilities: ["issue.view"] })]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("Viewer");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");

    const issueSection = within(dialog).getByText("Work orders").closest("fieldset")!;
    const viewRadio = within(issueSection).getByText("View").closest("[data-slot='radio-group-item']");
    expect(viewRadio).toHaveAttribute("data-checked");
  });

  it("admin toggles are independent from module tiers", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Admin");

    // Toggle project.manage and members.manage on.
    await user.click(within(dialog).getByRole("switch", { name: "Manage project" }));
    await user.click(within(dialog).getByRole("switch", { name: "Manage members" }));

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      // No module tiers selected (all none), just admin caps.
      expect(body.capabilities).toEqual(["project.manage", "members.manage"]);
    });
  });

  it("reader preset sets all modules to View and no admin caps", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "ReadOnly");

    await user.click(within(dialog).getByRole("button", { name: "Reader" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body.capabilities).toEqual(["issue.view", "procurement.view", "files.view"]);
    });
  });

  it("commenter preset sets issue=Comment, procurement=Comment, files=View", async () => {
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Commenter");

    await user.click(within(dialog).getByRole("button", { name: "Commenter" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

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
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Writer");

    await user.click(within(dialog).getByRole("button", { name: "Writer" }));
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

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
    const user = userEvent.setup();
    routeFetch([]);
    renderWithProviders(<ProjectSettingsRoles projectId="p1" canManage />);
    await screen.findByText("No roles defined.");

    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Mixed");

    const issueSection = within(dialog).getByText("Work orders").closest("fieldset")!;
    await user.click(within(issueSection).getByText("Manage"));

    const procSection = within(dialog).getByText("Procurement").closest("fieldset")!;
    await user.click(within(procSection).getByText("View"));

    // Files stays None (default).

    await user.click(within(dialog).getByRole("button", { name: "Add" }));

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
