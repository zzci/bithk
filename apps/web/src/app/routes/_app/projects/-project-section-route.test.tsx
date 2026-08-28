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
  // Not a mountable section: its tab follows the ship preset, so it gates on
  // `ship-profile` rather than on a key of its own.
  { key: "ship-profile", Body: routeBody(SubProjectsRoute) },
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

// ── Known divergence ──
//
// `issues`, `procurement` and `files` are mountable sections too, but their
// route bodies predate the section registry: they gate on the VIEW CAPABILITY
// only and bounce to the overview when it is missing, so they never reach
// `useProjectSectionRoute`. A member who still holds `files.view` on a project
// that has since unmounted `files` therefore renders the tab, and only its
// data requests 404 (the API gates those with `requireSection`).
//
// These tests pin the behaviour as it actually is rather than as PLAN-108
// describes it; the divergence is reported, not fixed here (D3 is test-only).
const CAPABILITY_GATED = [
  { key: "issues", capability: "issue.view", Body: routeBody(IssuesRoute) },
  { key: "procurement", capability: "procurement.view", Body: routeBody(ProcurementRoute) },
  { key: "files", capability: "files.view", Body: routeBody(FilesRoute) },
] as const;

describe("capability-gated section routes", () => {
  for (const { key, capability, Body } of CAPABILITY_GATED) {
    it(`renders \`${key}\` on an unmounted section while the caller holds ${capability}`, () => {
      const queryClient = makeTestQueryClient();
      queryClient.setQueryData(projectKeys.detail("p1"), { ...project([]), capabilities: [capability] });
      // No 404 and no redirect: the guard the four registry routes share is
      // absent here. See the note above.
      expect(() => renderWithProviders(<Body />, { queryClient })).not.toThrow();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it(`redirects \`${key}\` to the overview without ${capability}`, () => {
      const queryClient = makeTestQueryClient();
      queryClient.setQueryData(projectKeys.detail("p1"), { ...project([key]), capabilities: [] });
      renderWithProviders(<Body />, { queryClient });
      expect(navigateMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/projects/$projectId", params: { projectId: "p1" }, replace: true }),
      );
    });
  }
});
