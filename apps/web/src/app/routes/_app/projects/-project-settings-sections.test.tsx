import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectSettingsSections } from "./-project-settings-sections";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
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

function project(sections: readonly string[]): ProjectView {
  return {
    id: "p1",
    code: "BRG",
    name: "Bridge",
    status: "active",
    description: null,
    sections,
    tags: [],
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-23T00:00:00.000Z",
  } as ProjectView;
}

const GENERAL = ["issues", "procurement", "files"] as const;

describe("projectSettingsSections", () => {
  it("lists every mountable section with the mounted ones switched on", () => {
    renderWithProviders(<ProjectSettingsSections project={project(GENERAL)} canManage />);

    expect(screen.getByRole("switch", { name: "Work Orders" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Procurement" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Files" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Equipment" })).not.toBeChecked();
    // Non-sections never appear: they cannot be mounted.
    expect(screen.queryByRole("switch", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("mounts an unmounted section with a PUT to its section route", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProjectSettingsSections project={project(GENERAL)} canManage />);

    await user.click(screen.getByRole("switch", { name: "Equipment" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => (c[1]?.method ?? "GET") === "PUT");
      expect(call).toBeTruthy();
      expect(String(call![0])).toBe("/api/projects/p1/sections/equipment");
    });
  });

  it("surfaces the 409 SECTION_NOT_EMPTY refusal as a specific message", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return jsonResponse(
          { success: false, error: { code: "SECTION_NOT_EMPTY", message: "Section 'files' still has data" } },
          { status: 409 },
        );
      }
      return jsonResponse({ success: true, data: [] });
    });
    renderWithProviders(<ProjectSettingsSections project={project(GENERAL)} canManage />);

    await user.click(screen.getByRole("switch", { name: "Files" }));

    // Named section + what to do next, not a generic "operation failed".
    expect(await screen.findByText(/"Files" still holds data and cannot be removed/)).toBeInTheDocument();
  });

  it("falls back to a generic failure message for any other error", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return jsonResponse(
          { success: false, error: { code: "INTERNAL", message: "boom" } },
          { status: 500 },
        );
      }
      return jsonResponse({ success: true, data: [] });
    });
    renderWithProviders(<ProjectSettingsSections project={project(GENERAL)} canManage />);

    await user.click(screen.getByRole("switch", { name: "Files" }));

    expect(await screen.findByText("Could not remove this section.")).toBeInTheDocument();
    expect(screen.queryByText(/still holds data/)).not.toBeInTheDocument();
  });

  it("disables every switch for a viewer who cannot manage the project", () => {
    renderWithProviders(<ProjectSettingsSections project={project(GENERAL)} canManage={false} />);
    // base-ui marks the switch aria-disabled rather than adding the native
    // `disabled` attribute to its span.
    for (const toggle of screen.getAllByRole("switch"))
      expect(toggle).toHaveAttribute("aria-disabled", "true");
  });
});
