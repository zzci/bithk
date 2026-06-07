import type { DriveFileListSurfaceActions } from "./-drive-file-list-surface";
import type { DisplayItem } from "@/shared/lib/file";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";

// The heavy shared surface is replaced with a thin harness that renders the
// items and exposes the two actions the picker relies on (preview = pick,
// navigate). This keeps the test focused on the picker's own wiring.
vi.mock("./-drive-file-list-surface", () => ({
  DriveFileListSurface: ({ items, actions }: {
    items: readonly DisplayItem[];
    actions: DriveFileListSurfaceActions;
  }) => (
    <div>
      {items.map(item => (
        <div key={item.id}>
          <button type="button" onClick={() => actions.onPreview?.(item)}>{`open:${item.name}`}</button>
          <button type="button" onClick={() => actions.onNavigateToFolder?.(item.id, item.name)}>{`nav:${item.name}`}</button>
        </div>
      ))}
    </div>
  ),
}));

const { DriveFilePicker } = await import("./-drive-file-picker");

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("driveFilePicker", () => {
  it("resolves with the chosen file and closes", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: [{ id: "file1", name: "report.pdf", type: "file", ownerType: "user", ownerId: "self", parentEntryId: null, file: { fileId: "f1", mimetype: "application/pdf", size: 1 }, favorite: false, status: "normal", createdAt: "", updatedAt: "" }],
    }));
    renderWithProviders(<DriveFilePicker open onOpenChange={onOpenChange} onPick={onPick} />);

    await user.click(await screen.findByText("open:report.pdf"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "file1", name: "report.pdf" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigates into a folder and re-queries that folder's contents", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url) => {
      const parent = new URL(`http://x${String(url)}`).searchParams.get("parentEntryId");
      calls.push(parent ?? "root");
      if (!parent) {
        return jsonResponse({
          success: true,
          data: [{ id: "fold1", name: "Folder", type: "folder", ownerType: "user", ownerId: "self", parentEntryId: null, favorite: false, status: "normal", createdAt: "", updatedAt: "" }],
        });
      }
      return jsonResponse({ success: true, data: [] });
    });
    renderWithProviders(<DriveFilePicker open onOpenChange={() => {}} onPick={() => {}} />);

    await user.click(await screen.findByText("nav:Folder"));
    // The folder becomes the new parent, so a fetch scoped to it fires.
    await waitFor(() => expect(calls).toContain("fold1"));
  });

  it("forwards owner scoping for a team directory", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderWithProviders(
      <DriveFilePicker open onOpenChange={() => {}} onPick={() => {}} ownerType="team_directory" ownerId="td1" />,
    );
    await waitFor(() => {
      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url).toContain("ownerType=team_directory");
      expect(url).toContain("ownerId=td1");
    });
  });
});
