import type { ShipView } from "@/shared/lib/api/ships";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { ShipFilesTab } from "./-ship-files-tab";

// Reuse-not-fork: the Files tab must mount the shared project FileBrowser,
// pointed at the base project. Stub it so we assert the wiring (ownerType +
// ownerId + the threaded canManage) without pulling in the full drive surface.
const fileBrowserMock = vi.fn();
vi.mock("../-file-browser", () => ({
  FileBrowser: (props: { ownerType: string; ownerId: string; rootLabel?: string; canManage?: boolean }) => {
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

// The Files tab anchors drive permission on the base project's detail payload.
// Stub the project query so caps are deterministic without a network round-trip.
const useProjectMock = vi.fn();
vi.mock("@/shared/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    useProject: (id?: string) => useProjectMock(id),
  };
});

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return { id: "s1", name: "Serenity", baseProjectId: "p1", ...overrides } as ShipView;
}

describe("shipFilesTab", () => {
  it("threads base-project manage caps into the FileBrowser", () => {
    useProjectMock.mockReturnValue({ data: { id: "p1", capabilities: ["project.manage"] } });
    renderWithProviders(<ShipFilesTab ship={ship()} />);
    expect(screen.getByTestId("file-browser")).toHaveTextContent("project:p1");
    expect(fileBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "project", ownerId: "p1", rootLabel: "Serenity", canManage: true }),
    );
  });

  it("gives a viewer without base-project manage a read-only drive", () => {
    useProjectMock.mockReturnValue({ data: { id: "p1", capabilities: [] } });
    renderWithProviders(<ShipFilesTab ship={ship()} />);
    expect(fileBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "p1", canManage: false }),
    );
  });

  it("shows a placeholder when the ship has no base project", () => {
    useProjectMock.mockReturnValue({ data: undefined });
    renderWithProviders(<ShipFilesTab ship={ship({ baseProjectId: null })} />);
    expect(screen.queryByTestId("file-browser")).not.toBeInTheDocument();
    expect(screen.getByText("This ship has no base project, so there are no files yet.")).toBeInTheDocument();
  });
});
