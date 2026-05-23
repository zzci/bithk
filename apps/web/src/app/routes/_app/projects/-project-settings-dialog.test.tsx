import type { ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsDialog } from "./-project-settings-dialog";
import { computeCapabilities } from "./-use-project-role";

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
    expect(screen.getByRole("tab", { name: "Members & roles" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Categories" })).toBeInTheDocument();
  });

  it("shows only the contacts tab to a contacts-only member", () => {
    const caps = computeCapabilities(["contacts.manage"], false);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByRole("tab", { name: "Contacts" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "General" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Members & roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Categories" })).not.toBeInTheDocument();
  });

  it("merges the members tab when either members or roles can be managed", () => {
    const caps = computeCapabilities(["roles.manage"], false);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByRole("tab", { name: "Members & roles" })).toBeInTheDocument();
    // Roles-only access still surfaces the roles section heading inside the tab.
    expect(screen.getByText("Roles")).toBeInTheDocument();
  });

  it("renders the dialog title and description", () => {
    const caps = computeCapabilities(undefined, true);
    renderWithProviders(
      <ProjectSettingsDialog open onOpenChange={vi.fn()} project={project} members={[]} userNames={new Map()} caps={caps} />,
    );
    expect(screen.getByText("Project settings")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
