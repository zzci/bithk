import type { DriveFileListSurfaceActions } from "./-drive-file-list-surface";
import type { DisplayItem } from "./-file-browser-types";
import type { DriveEntry } from "@/shared/lib/api/drive";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";
import { renderWithProviders } from "@/test/utils";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// Spreadsheets now open a state-driven dialog (no route navigation); the
// useNavigate stub stays as a guard so any co-imported module that resolves it
// gets a no-op, and the tests can assert navigation never fires.
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

// Stub the lazy Univer editor dialog (default export, loaded via React.lazy)
// with a marker so the spreadsheet open path can be asserted without pulling
// in @univerjs.
vi.mock("./-univer-sheet-editor-dialog", () => ({
  default: ({ entry }: { entry: DriveEntry }) => (
    <div data-testid="sheet-editor-dialog">{`sheet:${entry.name}`}</div>
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

  it("opens the spreadsheet editor dialog for a Univer spreadsheet instead of previewing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FileBrowser ownerType="user" ownerId="self" />);

    await user.click(await screen.findByText("open:budget.sheet"));
    expect(await screen.findByTestId("sheet-editor-dialog")).toHaveTextContent("sheet:budget.sheet");
    expect(screen.queryByTestId("preview-dialog")).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
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
