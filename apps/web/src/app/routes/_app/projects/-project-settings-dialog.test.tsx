import type { ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { computeCapabilities } from "./-use-project-role";

// The General section (mounted by default) navigates away on project delete;
// stub useNavigate so the dialog can render without a live router.
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateMock,
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  // Child tabs fire list queries on mount; answer them all with an empty set.
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

const project: ProjectView = {
  id: "p1",
  code: null,
  name: "Bridge",
  status: "active",
  description: null,
  tags: [],
  coverImageUrl: null,
  creatorId: "u1",
  version: 1,
  updatedAt: "2026-05-23T00:00:00.000Z",
};

describe("projectSettingsDialog", () => {
  it("shows every tab to an app admin", () => {
    const caps = computeCapabilities(undefined, true);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Procurement Categories" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Danger zone" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Contacts" })).not.toBeInTheDocument();
  });

  it("shows only the categories tab to a categories-only member", () => {
    const caps = computeCapabilities(["categories.manage"], false);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByRole("tab", { name: "Procurement Categories" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "General" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Danger zone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Contacts" })).not.toBeInTheDocument();
  });

  it("shows only the roles tab to a roles-only member", () => {
    const caps = computeCapabilities(["roles.manage"], false);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    // Members and roles are now independently gated sections.
    expect(screen.getByRole("tab", { name: "Roles" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Danger zone" })).not.toBeInTheDocument();
    // The roles-only viewer lands on the roles section by default: the in-page
    // role editor renders its role-selector dropdown and a create action.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("shows only the members tab to a members-only member", () => {
    const caps = computeCapabilities(["members.manage"], false);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Danger zone" })).not.toBeInTheDocument();
  });

  it("renders the dialog title and description", () => {
    const caps = computeCapabilities(undefined, true);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByText("Project settings")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("pins a labeled, copyable project id to the sidebar", () => {
    const caps = computeCapabilities(undefined, true);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    const copy = screen.getByRole("button", { name: "Copy project ID" });
    expect(copy).toBeInTheDocument();
    // The canonical short id (project.id, no 'p-' prefix) is prefixed by the
    // localized "Project ID:" label.
    expect(copy).toHaveTextContent("Project ID:");
    expect(copy).toHaveTextContent("p1");
  });
});
