import type { DriveEntry } from "@/shared/lib/api/drive";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import {
  CreateFolderDialog,
  CreateTextFileDialog,
  MoveDialog,
  RenameDialog,
} from "./-entry-create-dialogs";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function noop() {}

function entry(overrides: Partial<DriveEntry> = {}): DriveEntry {
  return {
    id: "e1",
    name: "report.txt",
    type: "file",
    parentEntryId: null,
    file: { fileId: "f1" },
    favorite: false,
    status: "normal",
    ...overrides,
  } as DriveEntry;
}

describe("createFolderDialog", () => {
  it("keeps Create disabled until a non-blank name is typed, then submits trimmed", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<CreateFolderDialog open pending={false} onOpenChange={noop} onCreate={onCreate} />);
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "  Docs  ");
    expect(create).toBeEnabled();
    await user.click(create);
    expect(onCreate).toHaveBeenCalledWith("Docs");
  });

  it("shows a saving label while pending", () => {
    renderWithProviders(<CreateFolderDialog open pending onOpenChange={noop} onCreate={noop} />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });
});

describe("createTextFileDialog", () => {
  it("appends .txt for a plain text file", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<CreateTextFileDialog open pending={false} onOpenChange={noop} onCreate={onCreate} />);
    await user.type(screen.getByLabelText("Name"), "notes");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "notes.txt" });
  });

  it("appends .md for a markdown file and does not double the extension", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    renderWithProviders(<CreateTextFileDialog open markdown pending={false} onOpenChange={noop} onCreate={onCreate} />);
    await user.type(screen.getByLabelText("Name"), "readme.md");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "readme.md" });
  });
});

describe("renameDialog", () => {
  it("seeds the current name and submits the trimmed new name", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderWithProviders(
      <RenameDialog open entry={entry({ name: "old.txt" })} pending={false} onOpenChange={noop} onRename={onRename} />,
    );
    const input = screen.getByDisplayValue("old.txt");
    await user.clear(input);
    await user.type(input, "new.txt");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenCalledWith("new.txt");
  });

  it("renders nothing inside the dialog when no entry is supplied", () => {
    renderWithProviders(<RenameDialog open entry={null} pending={false} onOpenChange={noop} onRename={noop} />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("moveDialog", () => {
  it("lists folders, hides the moving entry, navigates and moves into a folder", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    fetchMock.mockImplementation(async (url) => {
      const parent = new URL(`http://x${String(url)}`).searchParams.get("parentEntryId");
      if (!parent) {
        // Root listing: a target folder, plus the entry being moved (filtered out).
        return jsonResponse({
          success: true,
          data: [
            { id: "fold-a", name: "Folder A", type: "folder", parentEntryId: null },
            { id: "e1", name: "self", type: "folder", parentEntryId: null },
          ],
        });
      }
      return jsonResponse({ success: true, data: [] });
    });

    renderWithProviders(
      <MoveDialog
        open
        entry={entry({ id: "e1", parentEntryId: null })}
        owner={{ ownerType: "user", ownerId: "self" }}
        pending={false}
        onOpenChange={noop}
        onMove={onMove}
      />,
    );

    // The moving entry (id e1) is filtered out; only "Folder A" is offered.
    const folderBtn = await screen.findByText("Folder A");
    expect(screen.queryByText("self")).not.toBeInTheDocument();
    // At root the entry is already here, so "Move here" is disabled.
    expect(screen.getByRole("button", { name: "Move here" })).toBeDisabled();

    await user.click(folderBtn);
    // Now inside Folder A (a different location) → enabled → moves there.
    const moveHere = await screen.findByRole("button", { name: "Move here" });
    await waitFor(() => expect(moveHere).toBeEnabled());
    await user.click(moveHere);
    expect(onMove).toHaveBeenCalledWith("fold-a");
  });

  it("shows the empty hint when a folder has no subfolders", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderWithProviders(
      <MoveDialog
        open
        entry={entry({ id: "e1", parentEntryId: "p0" })}
        owner={{ ownerType: "user", ownerId: "self" }}
        pending={false}
        onOpenChange={noop}
        onMove={vi.fn()}
      />,
    );
    expect(await screen.findByText("No subfolders here")).toBeInTheDocument();
  });
});
