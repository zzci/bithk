import type { DriveEntry } from "@/shared/lib/api/drive";
import { describe, expect, it } from "vitest";
import { detectFileType, entryToDisplayItem } from "./index";

describe("detectFileType", () => {
  it("classifies common mime types", () => {
    expect(detectFileType("application/pdf")).toBe("pdf");
    expect(detectFileType("image/png")).toBe("image");
    expect(detectFileType("application/vnd.ms-excel")).toBe("spreadsheet");
    expect(detectFileType("text/csv")).toBe("spreadsheet");
    expect(detectFileType("application/x-univer-sheet")).toBe("spreadsheet");
    expect(detectFileType("application/msword")).toBe("document");
    expect(detectFileType("text/plain")).toBe("document");
    expect(detectFileType("application/octet-stream")).toBe("file");
  });
});

describe("entryToDisplayItem", () => {
  function entry(overrides: Partial<DriveEntry> = {}): DriveEntry {
    return {
      id: "e1",
      name: "thing",
      type: "file",
      ownerType: "user",
      ownerId: "self",
      parentEntryId: null,
      favorite: false,
      status: "normal",
      createdBy: "self",
      createdByName: "Alice",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      file: { fileId: "f1", filename: "thing.pdf", mimetype: "application/pdf", size: 100 },
      ...overrides,
    } as DriveEntry;
  }

  it("maps a folder, preferring updatedAt and flagging isFolder", () => {
    const item = entryToDisplayItem(entry({ type: "folder", name: "Docs", favorite: true, file: null }));
    expect(item).toMatchObject({ type: "folder", isFolder: true, fileId: null, isFavorite: true, name: "Docs" });
    expect(item.modified).toBe("2026-05-23T00:00:00.000Z");
  });

  it("maps a file with detected type, size and fileId", () => {
    const item = entryToDisplayItem(entry());
    expect(item).toMatchObject({ type: "pdf", isFolder: false, fileId: "f1", size: 100, mimeType: "application/pdf" });
  });

  it("populates owner from the resolved creator name", () => {
    expect(entryToDisplayItem(entry()).owner).toBe("Alice");
    expect(entryToDisplayItem(entry({ type: "folder", file: null })).owner).toBe("Alice");
  });

  it("collapses a team-directory owner to the team scope", () => {
    const item = entryToDisplayItem(entry({ ownerType: "team_directory" }));
    expect(item.ownerType).toBe("team");
  });

  it("falls back to the file's filename when the entry name is blank", () => {
    const item = entryToDisplayItem(entry({ name: "" }));
    expect(item.name).toBe("thing.pdf");
  });
});
