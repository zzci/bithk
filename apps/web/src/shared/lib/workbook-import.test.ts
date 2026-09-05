import { describe, expect, it } from "vitest";
import { readWorkbookSheets, WORKBOOK_ACCEPT, workbookBaseName } from "./workbook-import";

async function xlsxFixture(): Promise<Uint8Array> {
  const { writeXlsx } = await import("hucre/xlsx");
  return writeXlsx({
    sheets: [
      { name: "Summary", rows: [["Item", "Qty"], ["Widget", 3]] },
      { name: "Detail", rows: [["ok", true]] },
    ],
  });
}

describe("workbookBaseName", () => {
  it("strips a known workbook extension", () => {
    expect(workbookBaseName("Budget.xlsx")).toBe("Budget");
    expect(workbookBaseName("Legacy.XLS")).toBe("Legacy");
    expect(workbookBaseName("Sheet.ods")).toBe("Sheet");
  });

  it("leaves an unrelated name alone", () => {
    expect(workbookBaseName("notes.txt")).toBe("notes.txt");
    expect(workbookBaseName("Budget")).toBe("Budget");
  });
});

describe("wORKBOOK_ACCEPT", () => {
  it("covers the formats the reader dispatches on", () => {
    expect(WORKBOOK_ACCEPT.split(",")).toEqual([".xlsx", ".xlsb", ".xls", ".ods"]);
  });
});

describe("readWorkbookSheets", () => {
  it("reads every tab of an xlsx workbook with its values", async () => {
    const sheets = await readWorkbookSheets("book.xlsx", await xlsxFixture());

    expect(sheets.map(sheet => sheet.name)).toEqual(["Summary", "Detail"]);
    expect(sheets[0]!.rows).toEqual([["Item", "Qty"], ["Widget", 3]]);
    expect(sheets[1]!.rows).toEqual([["ok", true]]);
  });

  it("dispatches on the extension, not the bytes", async () => {
    // xlsx bytes handed to the legacy .xls reader must fail rather than be
    // silently misread — the extension is what selects the reader.
    await expect(readWorkbookSheets("book.xls", await xlsxFixture())).rejects.toThrow();
  });

  it("rejects bytes that are not a workbook at all", async () => {
    await expect(readWorkbookSheets("book.xlsx", new TextEncoder().encode("not a workbook"))).rejects.toThrow();
  });
});
