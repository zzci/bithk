import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectOverviewTab } from "./-project-overview-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    name: "Tower",
    code: "TWR",
    description: "A tall building",
    status: "active",
    creatorId: "u1",
    tags: [{ id: "t1", name: "infra" }],
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  } as ProjectView;
}

describe("projectOverviewTab", () => {
  it("renders the project description", () => {
    const members = [{ id: "m1" }, { id: "m2" }] as ProjectMemberView[];
    renderWithProviders(
      <ProjectOverviewTab
        project={project()}
        members={members}
        userNames={new Map([["u1", "Alice"]])}
      />,
    );
    expect(screen.getByText("A tall building")).toBeInTheDocument();
  });

  it("falls back to the description placeholder when none is provided", () => {
    renderWithProviders(
      <ProjectOverviewTab
        project={project({ description: "", code: null, tags: [] })}
        members={[]}
        userNames={new Map()}
      />,
    );
    expect(screen.getByText("No description provided.")).toBeInTheDocument();
  });

  it("lists member labels in the member preview", () => {
    const members = [
      { id: "m1", userId: "u2", displayName: null, title: "Lead" },
      { id: "m2", userId: null, displayName: "Guest", title: null },
    ] as ProjectMemberView[];
    renderWithProviders(
      <ProjectOverviewTab
        project={project()}
        members={members}
        userNames={new Map([["u1", "Alice"], ["u2", "Bob"]])}
      />,
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
  });

  it("shows the empty member placeholder when there are no members", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project()} members={[]} userNames={new Map()} />,
    );
    expect(screen.getByText("No members yet.")).toBeInTheDocument();
  });

  it("renders procurement category preview from the current API", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [
        { id: "c1", name: "Main engine", code: "ME", description: "Engine spares", createdAt: "", updatedAt: "" },
      ],
    }));
    renderWithProviders(
      <ProjectOverviewTab project={project()} members={[]} userNames={new Map()} />,
    );
    expect(await screen.findByText("Main engine")).toBeInTheDocument();
    expect(screen.getByText("ME")).toBeInTheDocument();
    expect(screen.getByText("Engine spares")).toBeInTheDocument();
  });
});
