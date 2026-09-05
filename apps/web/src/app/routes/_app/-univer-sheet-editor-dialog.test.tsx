import type { DriveEntry } from "@/shared/lib/api/drive";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/shared/stores/auth";
import { renderWithProviders } from "@/test/utils";

const mocks = vi.hoisted(() => ({
  fetchContent: vi.fn(),
  upload: vi.fn(),
  overwrite: vi.fn(),
  success: vi.fn(),
  snapshot: { id: "book", name: "Initial", sheetOrder: [], sheets: {} },
  onCommand: null as ((command: { type: number }) => void) | null,
  switchVersion: null as (() => void) | null,
}));

vi.mock("@univerjs/presets", () => ({
  CommandType: { MUTATION: 2 },
  LocaleType: { EN_US: "en-US", ZH_CN: "zh-CN" },
  mergeLocales: () => ({}),
  createUniver: () => ({
    univer: { dispose: vi.fn() },
    univerAPI: {
      createWorkbook: (data: typeof mocks.snapshot) => { mocks.snapshot = structuredClone(data); },
      getActiveWorkbook: () => ({ save: () => structuredClone(mocks.snapshot), setEditable: vi.fn() }),
      onCommandExecuted: (callback: typeof mocks.onCommand) => {
        mocks.onCommand = callback;
        return { dispose: () => {
          mocks.onCommand = null;
        } };
      },
    },
  }),
}));
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: () => ({}) }));
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-core/locales/zh-CN", () => ({ default: {} }));
vi.mock("@/shared/lib/api/drive", () => ({
  fetchDriveEntryContent: mocks.fetchContent,
  UNIVER_SHEET_MIME: "application/x-univer-sheet",
  useUploadVersion: () => ({ mutateAsync: mocks.upload, isPending: false }),
  useOverwriteVersion: () => ({ mutateAsync: mocks.overwrite }),
}));
vi.mock("@/shared/components/file/version-history-dialog", () => ({
  DriveVersionHistoryDialog: ({ onSwitched }: { onSwitched: () => void }) => {
    mocks.switchVersion = onSwitched;
    return null;
  },
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: vi.fn() } }));

const { UniverSheetEditorDialog } = await import("./-univer-sheet-editor-dialog");
const entry = { id: "sheet", name: "Sheet" } as DriveEntry;
const draftKey = "drive.sheet.draft.user.sheet";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.onCommand = null;
  mocks.snapshot = { id: "book", name: "Initial", sheetOrder: [], sheets: {} };
  mocks.fetchContent.mockResolvedValue(JSON.stringify(mocks.snapshot));
  useAuthStore.setState({ user: { id: "user", role: "user" } as never, loading: false });
});

async function edit(name: string) {
  await waitFor(() => expect(mocks.onCommand).not.toBeNull());
  act(() => {
    mocks.snapshot.name = name;
    mocks.onCommand?.({ type: 2 });
  });
}

describe("spreadsheet save recovery", () => {
  it("reloads an explicitly selected version even when its source matches the opening snapshot", async () => {
    renderWithProviders(<UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />);
    await edit("Local edit");
    await act(async () => {
      mocks.switchVersion?.();
    });
    await waitFor(() => expect(mocks.snapshot.name).toBe("Initial"));
  });

  it("clears a saved draft and reuses the session version for the next save", async () => {
    mocks.upload.mockResolvedValue([{ id: "version-1" }]);
    mocks.overwrite.mockResolvedValue([{ id: "version-1" }]);
    renderWithProviders(<UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />);
    await edit("First edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^Saved /));
    expect(localStorage.getItem(draftKey)).toBeNull();
    await edit("Second edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.overwrite).toHaveBeenCalledWith(expect.objectContaining({ versionId: "version-1" })));
    expect(mocks.upload).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^Saved /));
  });

  it("isolates a reopened session from the old session's pending save", async () => {
    const pending = Promise.withResolvers<readonly { id: string }[]>();
    mocks.upload.mockReturnValue(pending.promise);
    const { rerender, unmount } = renderWithProviders(
      <UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />,
    );
    await edit("First edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    await edit("Second edit");
    rerender(<UniverSheetEditorDialog entry={entry} open={false} canEdit onOpenChange={() => {}} />);
    rerender(<UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />);
    await edit("Reopened edit");
    await act(async () => {
      pending.resolve([{ id: "old-session-version" }]);
    });
    expect(mocks.snapshot.name).toBe("Reopened edit");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    unmount();
    expect(JSON.parse(localStorage.getItem(draftKey) ?? "null")?.content).toContain("Reopened edit");
  });

  it("keeps edits made during a save across refresh and close", async () => {
    const pending = Promise.withResolvers<readonly { id: string }[]>();
    mocks.upload.mockReturnValue(pending.promise);
    const { unmount, queryClient } = renderWithProviders(
      <UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />,
    );
    await edit("First edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    await edit("Later edit");
    await act(async () => {
      pending.resolve([{ id: "version-1" }]);
    });
    await act(async () => {
      queryClient.setQueryData(["drive", "entries", "sheet", "content"], JSON.stringify({ ...mocks.snapshot, name: "First edit" }));
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mocks.snapshot.name).toBe("Later edit");
    unmount();
    expect(JSON.parse(localStorage.getItem(draftKey) ?? "null")?.content).toContain("Later edit");
  });

  it("does not remove newer recovery data when a save finishes after close", async () => {
    const pending = Promise.withResolvers<readonly { id: string }[]>();
    mocks.upload.mockReturnValue(pending.promise);
    const { unmount } = renderWithProviders(
      <UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />,
    );
    await edit("First edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
    await edit("Later edit");
    unmount();
    await act(async () => {
      pending.resolve([{ id: "version-1" }]);
    });
    expect(JSON.parse(localStorage.getItem(draftKey) ?? "null")?.content).toContain("Later edit");
  });

  it("does not announce success when a save fails", async () => {
    mocks.upload.mockRejectedValue(new Error("Offline"));
    renderWithProviders(<UniverSheetEditorDialog entry={entry} open canEdit onOpenChange={() => {}} />);
    await edit("Unsaved edit");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/failed/i));
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
