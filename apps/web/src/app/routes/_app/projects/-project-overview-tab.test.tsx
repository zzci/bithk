import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectOverviewTab } from "./-project-overview-tab";

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
  it("renders description, status, code, member count and creator name", () => {
    const members = [{ id: "m1" }, { id: "m2" }] as ProjectMemberView[];
    renderWithProviders(
      <ProjectOverviewTab
        project={project()}
        members={members}
        userNames={new Map([["u1", "Alice"]])}
      />,
    );
    expect(screen.getByText("A tall building")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("TWR")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("infra")).toBeInTheDocument();
  });

  it("falls back to placeholders for missing description, code and tags", () => {
    renderWithProviders(
      <ProjectOverviewTab
        project={project({ description: "", code: null, tags: [] })}
        members={[]}
        userNames={new Map()}
      />,
    );
    expect(screen.getByText("No description provided.")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("No tags.")).toBeInTheDocument();
  });

  it("shows the raw creator id when the name is unknown", () => {
    renderWithProviders(
      <ProjectOverviewTab project={project({ creatorId: "u-unknown" })} members={[]} userNames={new Map()} />,
    );
    expect(screen.getByText("u-unknown")).toBeInTheDocument();
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
});
