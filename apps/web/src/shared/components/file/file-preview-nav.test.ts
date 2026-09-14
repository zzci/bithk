import type { DriveEntry } from "@/shared/lib/api/drive";

import { describe, expect, it } from "vitest";

import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";

import { previewableSiblings, siblingAt } from "./file-preview-nav";

function entry(id: string, name: string, mimetype: string, type: "file" | "folder" = "file"): DriveEntry {
  return {
    id,
    name,
    type,
    ownerType: "user",
    ownerId: "self",
    parentEntryId: null,
    file: type === "folder" ? null : { fileId: `f-${id}`, filename: name, mimetype, size: 1 },
    favorite: false,
    status: "normal",
    createdAt: "",
    updatedAt: "",
  } as unknown as DriveEntry;
}

const png = entry("a", "a.png", "image/png");
const pdf = entry("b", "b.pdf", "application/pdf");
const md = entry("c", "c.md", "text/markdown");

describe("previewableSiblings", () => {
  it("keeps previewable files in list order", () => {
    expect(previewableSiblings([png, pdf, md]).map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("drops folders, spreadsheets and unpreviewable files", () => {
    const entries = [
      entry("dir", "docs", "", "folder"),
      png,
      entry("sheet", "budget.sheet", UNIVER_SHEET_MIME),
      entry("zip", "bundle.zip", "application/zip"),
    ];
    expect(previewableSiblings(entries).map(e => e.id)).toEqual(["a"]);
  });
});

describe("siblingAt", () => {
  const siblings = [png, pdf, md];

  it("steps forward and backward", () => {
    expect(siblingAt(siblings, "b", 1)?.id).toBe("c");
    expect(siblingAt(siblings, "b", -1)?.id).toBe("a");
  });

  it("returns null at both ends", () => {
    expect(siblingAt(siblings, "a", -1)).toBeNull();
    expect(siblingAt(siblings, "c", 1)).toBeNull();
  });

  it("returns null when the current entry is outside the sequence", () => {
    expect(siblingAt(siblings, "zip", 1)).toBeNull();
    expect(siblingAt([], "a", 1)).toBeNull();
  });
});
