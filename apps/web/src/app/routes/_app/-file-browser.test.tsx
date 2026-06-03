import type { DriveFileListSurfaceActions } from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";
import { renderWithProviders } from "@/test/utils";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// FileBrowser calls useNavigate() for the spreadsheet open-route; the rest of
// the router is left intact so co-imported modules keep their exports.
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateMock,
}));

// Thin surface harness exposing the preview action per item and reflecting the
// search toggle — keeps the test focused on the browser's own wiring.
vi.mock("./-drive-file-list-surface", () => ({
  DriveFileListSurface: ({ items, actions, showSearch }: {
    items: readonly DisplayItem[];
    actions: DriveFileListSurfaceActions;
    showSearch?: boolean;
  }) => (
    <div>
      {showSearch && <input aria-label="search" />}
      {items.map(item => (
        <button key={item.id} type="button" onClick={() => actions.onPreview?.(item)}>
          {`open:${item.name}`}
        </button>
      ))}
    </div>
  ),
}));

// Stub the heavy preview dialog with a marker so we can assert it renders and
// reflects readOnly, without pulling in pdfjs / CodeMirror.
vi.mock("./-file-preview-dialog", () => ({
  FilePreviewDialog: ({ entry, readOnly }: { entry: DriveEntry; readOnly?: boolean }) => (
    <div data-testid="preview-dialog">{`preview:${entry.name}:${readOnly ? "ro" : "rw"}`}</div>
  ),
}));

const { FileBrowser } = await import("./-file-browser");

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function fileEntry(id: string, name: string, mimetype: string): DriveEntry {
  return {
    id,
    name,
    type: "file",
    ownerType: "user",
    ownerId: "self",
    parentEntryId: null,
    file: { fileId: `f-${id}`, mimetype, size: 1 },
    favorite: false,
    status: "normal",
    createdAt: "",
    updatedAt: "",
  } as unknown as DriveEntry;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  navigateMock.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  fetchMock.mockResolvedValue(jsonResponse({
    success: true,
    data: [
      fileEntry("file1", "report.pdf", "application/pdf"),
      fileEntry("sheet1", "budget.sheet", UNIVER_SHEET_MIME),
    ],
  }));
});

afterEach(() => {
  fetchMock.mockReset();
});

describe("fileBrowser internal preview", () => {
  it("renders the preview dialog when opening a normal file without a parent handler", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" />);

    await user.click(await screen.findByText("open:report.pdf"));
    expect(screen.getByTestId("preview-dialog")).toHaveTextContent("preview:report.pdf:rw");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to the sheet editor for a Univer spreadsheet instead of previewing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" />);

    await user.click(await screen.findByText("open:budget.sheet"));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/drive/sheet/$entryId", params: { entryId: "sheet1" } });
    expect(screen.queryByTestId("preview-dialog")).not.toBeInTheDocument();
  });

  it("opens the preview read-only for a viewer (canManage=false)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" canManage={false} />);

    await user.click(await screen.findByText("open:report.pdf"));
    expect(screen.getByTestId("preview-dialog")).toHaveTextContent("preview:report.pdf:ro");
  });

  it("renders the search box by default", async () => {
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" />);
    expect(await screen.findByLabelText("search")).toBeInTheDocument();
  });

  it("hides the search box when the search feature is disabled", async () => {
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" features={{ search: false }} />);
    // Wait for the listing to render, then assert the toggle removed the box.
    await screen.findByText("open:report.pdf");
    expect(screen.queryByLabelText("search")).not.toBeInTheDocument();
  });
});
