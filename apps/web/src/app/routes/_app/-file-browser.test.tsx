import type { DriveFileListSurfaceActions } from "@/shared/components/file";
import type { DriveEntry } from "@/shared/lib/api/drive";
import type { DisplayItem } from "@/shared/lib/file";
import { WORKBOOK_ACCEPT } from "@app/spreadsheet";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileUploadStore } from "@/shared/components/file";
import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";
import { renderWithProviders } from "@/test/utils";

const { navigateMock, toastError } = vi.hoisted(() => ({ navigateMock: vi.fn(), toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

// Spreadsheets now open a state-driven dialog (no route navigation); the
// useNavigate stub stays as a guard so any co-imported module that resolves it
// gets a no-op, and the tests can assert navigation never fires.
vi.mock("@tanstack/react-router", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigateMock,
}));

// Thin surface harness exposing the preview action per item and reflecting the
// search toggle — keeps the test focused on the browser's own wiring.
vi.mock("@/shared/components/file/file-list-surface", () => ({
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
vi.mock("@/shared/components/file/file-preview-dialog", () => ({
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
  toastError.mockReset();
  useFileUploadStore.setState({ tasks: [] });
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

describe("fileBrowser excel import", () => {
  // The list query and the spreadsheet POST share one mock, so route by URL and
  // hand back a fresh Response per call (a Response body reads only once).
  function routeFetch(onSpreadsheet?: () => void) {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/drive/entries/spreadsheet")) {
        onSpreadsheet?.();
        return Promise.resolve(jsonResponse({
          success: true,
          data: fileEntry("new", "Budget.sheet", UNIVER_SHEET_MIME),
        }));
      }
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
  }

  async function pickWorkbook(filename: string, bytes: Uint8Array) {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<FileBrowser ownerType="user" ownerId="self" />);
    const input = container.querySelector<HTMLInputElement>(`input[accept="${WORKBOOK_ACCEPT}"]`);
    expect(input).not.toBeNull();
    await user.upload(input!, new File([bytes as BlobPart], filename));
  }

  function spreadsheetPayload() {
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/drive/entries/spreadsheet"));
    return call ? JSON.parse(String((call[1] as RequestInit).body)) as { name: string; content: string } : null;
  }

  it("uploads the original workbook and creates a converted sheet beside it", async () => {
    const { writeXlsx } = await import("hucre/xlsx");
    const bytes = await writeXlsx({
      sheets: [
        { name: "Summary", rows: [["Item", "Qty"], ["Widget", 3]] },
        { name: "Detail", rows: [["ok", true]] },
      ],
    });
    routeFetch();

    await pickWorkbook("Budget.xlsx", bytes);

    // Leg 1: the original file goes onto the upload queue untouched.
    await waitFor(() => {
      expect(useFileUploadStore.getState().tasks.map(task => task.name)).toContain("Budget.xlsx");
    });

    // Leg 2: a sibling `.sheet` entry carrying the converted snapshot.
    await waitFor(() => expect(spreadsheetPayload()).not.toBeNull());
    const payload = spreadsheetPayload()!;
    expect(payload.name).toBe("Budget.sheet");

    const snapshot = JSON.parse(payload.content) as {
      name: string;
      sheetOrder: string[];
      sheets: Record<string, { name: string; cellData: Record<string, Record<string, { v: unknown }>> }>;
    };
    expect(snapshot.name).toBe("Budget");
    expect(snapshot.sheetOrder).toHaveLength(2);
    expect(snapshot.sheets[snapshot.sheetOrder[0]!]!.name).toBe("Summary");
    expect(snapshot.sheets[snapshot.sheetOrder[0]!]!.cellData[1]![1]!.v).toBe(3);
  });

  it("uploads nothing and creates nothing when the workbook cannot be read", async () => {
    routeFetch();

    await pickWorkbook("Broken.xlsx", new TextEncoder().encode("not a workbook"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not import this workbook."));
    expect(spreadsheetPayload()).toBeNull();
    expect(useFileUploadStore.getState().tasks).toHaveLength(0);
  });
});
