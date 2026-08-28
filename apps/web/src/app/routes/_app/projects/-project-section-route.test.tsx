// Section tab ROUTE BODIES: a deep link to a section the project does not
// mount must render the app's 404 page, never a half-broken tab.
//
// `useProjectSectionRoute` decides that during render, so the project is seeded
// into the query cache up front: the guard then runs on the very first render
// and the `notFound()` throw surfaces straight out of `render()`.

import type { ComponentType } from "react";
import type { ProjectView } from "@/shared/lib/api/projects";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectKeys } from "@/shared/lib/api/projects";
import { useAuthStore } from "@/shared/stores/auth";
import { makeTestQueryClient, renderWithProviders } from "@/test/utils";
import { Route as EquipmentRoute } from "./$projectId.equipment.lazy";
import { Route as FilesRoute } from "./$projectId.files.lazy";
import { Route as IssuesRoute } from "./$projectId.issues.lazy";
import { Route as ProcurementRoute } from "./$projectId.procurements.lazy";
import { Route as ProfileRoute } from "./$projectId.profile.lazy";
import { Route as SubProjectsRoute } from "./$projectId.sub-projects.lazy";
import { Route as WorklistRoute } from "./$projectId.worklist.lazy";

const navigateMock = vi.fn();
// `notFound()` throws a router-owned sentinel; a plain Error carrying a known
// message is enough to assert that the guard fired.
const NOT_FOUND = "ROUTER_NOT_FOUND";
vi.mock("@tanstack/react-router", () => ({
  createLazyFileRoute: () => (opts: unknown) => opts,
  useParams: () => ({ projectId: "p1" }),
  useNavigate: () => navigateMock,
  notFound: () => new Error(NOT_FOUND),
  Outlet: () => null,
}));

function routeBody(route: unknown): ComponentType {
  return (route as { component: ComponentType }).component;
}

// Every guarded section route, with the mount key it answers to.
const GUARDED = [
  { key: "ship-profile", Body: routeBody(ProfileRoute) },
  { key: "equipment", Body: routeBody(EquipmentRoute) },
  { key: "worklist", Body: routeBody(WorklistRoute) },
] as const;

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
}

function project(sections: readonly string[]): ProjectView {
  return {
    id: "p1",
    code: "PRJ-1",
    name: "Atlas Refit",
    status: "active",
    description: null,
    sections,
    tags: [],
    coverImageUrl: null,
    capabilities: ["issue.view", "procurement.view", "files.view", "project.manage"],
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-25T00:00:00.000Z",
  } as ProjectView;
}

/** A query client already holding the project, so the guard runs immediately. */
function seeded(sections: readonly string[] | null) {
  const queryClient = makeTestQueryClient();
  if (sections)
    queryClient.setQueryData(projectKeys.detail("p1"), project(sections));
  return queryClient;
}

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  fetchMock.mockImplementation(async () => jsonResponse({ success: true, data: [], meta: { total: 0, page: 1, limit: 20 } }));
  globalThis.fetch = fetchMock;
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("section route bodies", () => {
  for (const { key, Body } of GUARDED) {
    it(`404s when \`${key}\` is absent from project.sections (${Body.name})`, () => {
      expect(() => renderWithProviders(<Body />, { queryClient: seeded(["issues", "procurement", "files"]) }))
        .toThrow(NOT_FOUND);
    });

    it(`renders instead of 404ing once \`${key}\` is mounted (${Body.name})`, () => {
      expect(() => renderWithProviders(<Body />, { queryClient: seeded(["issues", "ship-profile", "equipment", "worklist"]) }))
        .not
        .toThrow();
    });
  }

  it("does not 404 while the project is still loading", () => {
    // An in-flight query has no `sections` yet; 404-ing on that would flash for
    // every deep link before the payload lands.
    for (const { Body } of GUARDED)
      expect(() => renderWithProviders(<Body />, { queryClient: seeded(null) })).not.toThrow();
  });
});

// `sub-projects` is not a mountable section and is NOT gated: `parent_id` is a
// core column and the API serves `/children` for every project, so the route
// renders whatever the project mounts.
describe("sub-projects route body", () => {
  const Body = routeBody(SubProjectsRoute);

  const CASES = [
    { label: "a general project", sections: ["issues", "procurement", "files"] },
    { label: "a ship project", sections: ["issues", "ship-profile", "equipment", "worklist"] },
    { label: "a project with nothing mounted", sections: [] },
  ] as const satisfies readonly { label: string; sections: readonly string[] }[];

  for (const { label, sections } of CASES) {
    it(`renders for ${label} instead of 404ing`, () => {
      expect(() => renderWithProviders(<Body />, { queryClient: seeded(sections) })).not.toThrow();
    });
  }

  it("does not 404 while the project is still loading", () => {
    expect(() => renderWithProviders(<Body />, { queryClient: seeded(null) })).not.toThrow();
  });
});

// `issues`, `procurement` and `files` are mountable sections whose route bodies
// carry BOTH gates: the mount decides whether the URL exists at all, the view
// capability decides whether this caller may see it. A missing mount is a 404;
// a missing capability is a redirect to the overview, so a viewer who simply
// lost access still lands somewhere they can read.
const CAPABILITY_GATED = [
  { key: "issues", capability: "issue.view", Body: routeBody(IssuesRoute) },
  { key: "procurement", capability: "procurement.view", Body: routeBody(ProcurementRoute) },
  { key: "files", capability: "files.view", Body: routeBody(FilesRoute) },
] as const;

describe("capability-gated section routes", () => {
  for (const { key, capability, Body } of CAPABILITY_GATED) {
    it(`404s \`${key}\` on an unmounted section even while the caller holds ${capability}`, () => {
      const queryClient = makeTestQueryClient();
      queryClient.setQueryData(projectKeys.detail("p1"), { ...project([]), capabilities: [capability] });
      // Holding the capability is not enough: the section is gone, so the URL
      // is gone with it rather than rendering a permanently empty tab.
      expect(() => renderWithProviders(<Body />, { queryClient })).toThrow(NOT_FOUND);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it(`renders \`${key}\` once the section is mounted and ${capability} is held`, () => {
      const queryClient = makeTestQueryClient();
      queryClient.setQueryData(projectKeys.detail("p1"), { ...project([key]), capabilities: [capability] });
      expect(() => renderWithProviders(<Body />, { queryClient })).not.toThrow();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it(`redirects \`${key}\` to the overview without ${capability}`, () => {
      const queryClient = makeTestQueryClient();
      queryClient.setQueryData(projectKeys.detail("p1"), { ...project([key]), capabilities: [] });
      // Mounted but unreadable for this caller: a redirect, never a 404.
      renderWithProviders(<Body />, { queryClient });
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/projects/$projectId", params: { projectId: "p1" }, replace: true }),
      );
    });

    it(`does not 404 \`${key}\` while the project is still loading`, () => {
      expect(() => renderWithProviders(<Body />, { queryClient: seeded(null) })).not.toThrow();
    });
  }
});
