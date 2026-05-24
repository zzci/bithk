import type { ShipView } from "@/shared/lib/api/ships";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipFilesTab } from "./-ship-files-tab";

// Reuse-not-fork: the Files tab must mount the shared project FileBrowser,
// pointed at the base project. Stub it so we assert the wiring (ownerType +
// ownerId) without pulling in the full drive surface.
const fileBrowserMock = vi.fn();
vi.mock("../-file-browser", () => ({
  FileBrowser: (props: { ownerType: string; ownerId: string; rootLabel?: string }) => {
    fileBrowserMock(props);
    return (
      <div data-testid="file-browser">
        {props.ownerType}
        :
        {props.ownerId}
      </div>
    );
  },
}));

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return { id: "s1", name: "Serenity", baseProjectId: "p1", lifecycleStage: "design", ...overrides } as ShipView;
}

describe("shipFilesTab", () => {
  it("mounts the project FileBrowser on the base project", () => {
    renderWithProviders(<ShipFilesTab ship={ship()} />);
    expect(screen.getByTestId("file-browser")).toHaveTextContent("project:p1");
    expect(fileBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "project", ownerId: "p1", rootLabel: "Serenity" }),
    );
  });

  it("shows a placeholder when the ship has no base project", () => {
    renderWithProviders(<ShipFilesTab ship={ship({ baseProjectId: null })} />);
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
    expect(screen.getByText("This ship has no base project, so there are no files yet.")).toBeInTheDocument();
  });
});
