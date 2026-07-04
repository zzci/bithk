import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsDanger } from "./-project-settings-danger";

// The delete action navigates away on success. Stub useNavigate so the test
// does not depend on a live router and can assert the destination.
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

// Mutating calls (PATCH/DELETE) resolve to `mutationResponse`; any incidental
// list call resolves to an empty set so the component renders cleanly.
function routeAware(mutationResponse: () => Response) {
  fetchMock.mockImplementation((input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/tags"))
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    return Promise.resolve(mutationResponse());
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  navigateMock.mockReset();
  routeAware(() => jsonResponse({ success: true, data: [] }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "BRG",
    name: "Bridge",
    status: "active",
    description: "A bridge",
    shipId: null,
    tags: [{ id: "t1", name: "infra" }],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectSettingsDanger", () => {
  it("archives an active project after confirming in the Danger zone", async () => {
    const user = userEvent.setup();
    routeAware(() => jsonResponse({ success: true, data: project({ status: "archived" }) }));
    renderWithProviders(<ProjectSettingsDanger project={project()} />);

    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Archive project?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/projects/p1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.status).toBe("archived");
    });
  });

  it("offers a Restore action for an archived project", () => {
    renderWithProviders(<ProjectSettingsDanger project={project({ status: "archived" })} />);
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("deletes the project and navigates away after confirming", async () => {
    const user = userEvent.setup();
    routeAware(() => jsonResponse({ success: true, data: null }));
    renderWithProviders(<ProjectSettingsDanger project={project()} />);

    await user.click(screen.getByRole("button", { name: "Delete project" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete project?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete project" }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "DELETE");
      expect(del).toBeTruthy();
      expect(String(del![0])).toBe("/api/projects/p1");
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/projects" }));
  });
});
