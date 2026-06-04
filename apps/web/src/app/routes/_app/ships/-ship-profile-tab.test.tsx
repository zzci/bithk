import type { ShipView } from "@/shared/lib/api/ships";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipProfileTab } from "./-ship-profile-tab";

const ship: ShipView = {
  id: "ship-atlas",
  code: "ATL-001",
  name: "Atlas Voyager",
  status: "active",
  tags: [],
  baseProjectId: "proj-atlas-refit",
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
  description: "Main-engine refit and class survey readiness vessel.",
  coverImageUrl: null,
  creatorId: "user-admin",
  version: 4,
  updatedAt: "2026-05-25T00:00:00.000Z",
};

describe("shipProfileTab", () => {
  it("renders read-only registry and specification fields from ShipView", () => {
    renderWithProviders(<ShipProfileTab ship={ship} canManage={false} />);

    expect(screen.getByRole("heading", { name: "Vessel profile" })).toBeInTheDocument();
    expect(screen.getAllByText("ATL-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9876543").length).toBeGreaterThan(0);
    expect(screen.getAllByText("299").length).toBeGreaterThan(0);
    expect(screen.getByText("Container 300")).toBeInTheDocument();
    expect(screen.getAllByText("Shanghai").length).toBeGreaterThan(0);
  });

  it("shows the edit affordance only when the caller can manage", () => {
    const { rerender } = renderWithProviders(<ShipProfileTab ship={ship} canManage />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    rerender(<ShipProfileTab ship={ship} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
