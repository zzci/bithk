import type { ShipProfileView } from "@/shared/lib/api/project-sections";
import type { ProjectView } from "@/shared/lib/api/projects";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ProjectShipProfileTab } from "./-project-ship-profile-tab";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

const project = {
  id: "p1",
  code: "PRJ-1",
  name: "Atlas Voyager",
  status: "active",
  description: null,
  sections: ["issues", "procurement", "files", "ship-profile", "equipment", "worklist"],
  tags: [],
  coverImageUrl: null,
  creatorId: "user-admin",
  version: 4,
  updatedAt: "2026-05-25T00:00:00.000Z",
} satisfies ProjectView;

const profile: ShipProfileView = {
  hullNumber: "ATL-001",
  shipStatus: "active",
  model: "Container 300",
  builder: "North Dock",
  buildYear: 2014,
  lengthOverall: 299,
  beam: 40,
  draft: 14.5,
  airDraft: 38.5,
  grossTonnage: 95500,
  imoNumber: "9876543",
  mmsi: "413258900",
  callSign: "BHQO5",
  flagState: "Panama",
  registryPort: "Shanghai",
  ownerName: "Atlas Marine",
  createdAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: profile }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("projectShipProfileTab", () => {
  it("reads the particulars from the project's ship-profile section", async () => {
    renderWithProviders(<ProjectShipProfileTab project={project} canManage={false} />);

    expect(screen.getByRole("heading", { name: "Vessel profile" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("ATL-001").length).toBeGreaterThan(0));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/ship-profile");
    expect(screen.getAllByText("9876543").length).toBeGreaterThan(0);
    expect(screen.getAllByText("299").length).toBeGreaterThan(0);
    expect(screen.getByText("Container 300")).toBeInTheDocument();
    expect(screen.getAllByText("Shanghai").length).toBeGreaterThan(0);
  });

  it("takes the vessel name from the project payload, not the section", async () => {
    renderWithProviders(<ProjectShipProfileTab project={project} canManage={false} />);
    await waitFor(() => expect(screen.getByText("Atlas Voyager")).toBeInTheDocument());
  });

  it("shows the edit affordance only when the caller can manage", async () => {
    const { rerender } = renderWithProviders(<ProjectShipProfileTab project={project} canManage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());

    rerender(<ProjectShipProfileTab project={project} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
