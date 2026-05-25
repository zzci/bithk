import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectMembersTab } from "./-project-members-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
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

describe("projectMembersTab", () => {
  it("renders read-only member cards with role and virtual badge", async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes("/members")) {
        return jsonResponse({
          success: true,
          data: [
            {
              id: "m1",
              userId: "u1",
              displayName: null,
              roleId: "r1",
              title: "Lead",
              createdAt: "2026-05-25T00:00:00.000Z",
              updatedAt: "2026-05-25T00:00:00.000Z",
            },
            {
              id: "m2",
              userId: null,
              displayName: "Vendor Lead",
              roleId: "r2",
              title: null,
              createdAt: "2026-05-25T00:00:00.000Z",
              updatedAt: "2026-05-25T00:00:00.000Z",
            },
          ],
        });
      }
      if (path.includes("/roles")) {
        return jsonResponse({
          success: true,
          data: [
            { id: "r1", name: "Project Manager", capabilities: [], isSystem: true, createdAt: "", updatedAt: "" },
            { id: "r2", name: "Field Lead", capabilities: [], isSystem: false, createdAt: "", updatedAt: "" },
          ],
        });
      }
      return jsonResponse({ success: true, data: [] });
    });

    renderWithProviders(
      <ProjectMembersTab projectId="p1" userNames={new Map([["u1", "Alice"]])} />,
    );

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Vendor Lead")).toBeInTheDocument();
    expect(screen.getAllByText("Project Manager").length).toBeGreaterThan(0);
    expect(screen.getByText("Virtual member")).toBeInTheDocument();
  });
});
