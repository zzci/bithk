import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsGeneral } from "./-project-settings-general";

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

function project(overrides: Partial<ProjectView> = {}): ProjectView {
  return {
    id: "p1",
    code: "BRG",
    name: "Bridge",
    status: "active",
    description: "A bridge",
    tags: [{ id: "t1", name: "infra", usageCount: 1 }],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectSettingsGeneral", () => {
  it("pre-fills the form from the project record", () => {
    renderWithProviders(<ProjectSettingsGeneral project={project()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Bridge");
    expect(screen.getByLabelText("Code")).toHaveValue("BRG");
    expect(screen.getByLabelText("Description")).toHaveValue("A bridge");
    expect(screen.getByText("infra")).toBeInTheDocument();
  });

  it("patches the project with the edited fields on save", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: project({ name: "Bridge II" }) }));
    renderWithProviders(<ProjectSettingsGeneral project={project()} />);

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Bridge II");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      expect(String(patch![0])).toBe("/api/projects/p1");
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.name).toBe("Bridge II");
      expect(body.status).toBe("active");
      expect(body.code).toBe("BRG");
      expect(body.tags).toEqual(["infra"]);
    });
  });

  it("disables save when the name is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSettingsGeneral project={project()} />);
    await user.clear(screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("normalizes blanked optional fields to null in the payload", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: project() }));
    renderWithProviders(<ProjectSettingsGeneral project={project()} />);

    await user.clear(screen.getByLabelText("Code"));
    await user.clear(screen.getByLabelText("Description"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET").toUpperCase() === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.code).toBeNull();
      expect(body.description).toBeNull();
    });
  });

  it("surfaces a save error in the banner", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(
      { success: false, error: { code: "CONFLICT", message: "stale version" } },
      { status: 409 },
    ));
    renderWithProviders(<ProjectSettingsGeneral project={project()} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });
});
