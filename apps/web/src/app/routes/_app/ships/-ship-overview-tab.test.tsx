import type { ShipView } from "@/shared/lib/api/ships";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipOverviewTab } from "./-ship-overview-tab";

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return {
    id: "s1",
    code: "HULL-1",
    name: "Serenity",
    status: "active",
    lifecycleStage: "building",
    baseProjectId: "p1",
    model: null,
    builder: "Acme Yards",
    buildYear: 2024,
    lengthOverall: null,
    beam: null,
    draft: null,
    grossTonnage: null,
    imoNumber: null,
    mmsi: null,
    callSign: null,
    flagState: null,
    registryPort: null,
    ownerName: null,
    description: "Flagship build",
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("shipOverviewTab", () => {
  it("renders the lifecycle stage, basic info and placeholders for unset fields", () => {
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage={false} />);
    expect(screen.getByText("Flagship build")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("HULL-1")).toBeInTheDocument();
    expect(screen.getByText("Acme Yards")).toBeInTheDocument();
    // model + several maritime fields are null → "Not set" placeholder.
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("hides the edit affordance when the caller cannot manage", () => {
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the edit affordance when the caller can manage", () => {
    renderWithProviders(<ShipOverviewTab ship={ship()} canManage />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});
