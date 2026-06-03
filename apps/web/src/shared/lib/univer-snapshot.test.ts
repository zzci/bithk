import { describe, expect, it } from "vitest";
import { csvToUniverSnapshotJson, emptyUniverSnapshotJson, parseCsv } from "./univer-snapshot";

interface ParsedSnapshot {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  sheetOrder: string[];
  sheets: Record<string, {
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
    cellData: Record<string, Record<string, { v: string }>>;
  }>;
}

function parse(json: string): ParsedSnapshot {
  return JSON.parse(json) as ParsedSnapshot;
}

function firstSheet(snapshot: ParsedSnapshot) {
  const id = snapshot.sheetOrder[0]!;
  return snapshot.sheets[id]!;
}

describe("emptyUniverSnapshotJson", () => {
  it("produces a valid one-sheet workbook", () => {
    const snapshot = parse(emptyUniverSnapshotJson());
    expect(snapshot.sheetOrder).toHaveLength(1);
    expect(snapshot.appVersion).toBe("0.25.0");
    expect(snapshot.locale).toBe("enUS");

    const sheet = firstSheet(snapshot);
    expect(sheet.id).toBe(snapshot.sheetOrder[0]);
    expect(sheet.rowCount).toBe(100);
    expect(sheet.columnCount).toBe(26);
    expect(sheet.cellData).toEqual({});
  });

  it("uses the supplied name and falls back to a default", () => {
    expect(parse(emptyUniverSnapshotJson("Budget")).name).toBe("Budget");
    expect(parse(emptyUniverSnapshotJson("   ")).name).toBe("Untitled");
    expect(parse(emptyUniverSnapshotJson()).name).toBe("Untitled");
  });
});

describe("parseCsv", () => {
  it("splits simple rows and columns", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv("\"a,b\",c")).toEqual([["a,b", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv("\"she said \"\"hi\"\"\"")).toEqual([["she said \"hi\""]]);
  });

  it("handles quoted newlines and CRLF row breaks", () => {
    expect(parseCsv("\"line1\nline2\",x\r\ny,z")).toEqual([["line1\nline2", "x"], ["y", "z"]]);
  });

  it("does not emit a trailing empty row for a final newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("preserves trailing empty fields", () => {
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
});

describe("csvToUniverSnapshotJson", () => {
  it("maps cells to sparse cellData sized to the data", () => {
    const sheet = firstSheet(parse(csvToUniverSnapshotJson("a,b\nc,d")));
    expect(sheet.rowCount).toBe(2);
    expect(sheet.columnCount).toBe(2);
    expect(sheet.cellData).toEqual({
      0: { 0: { v: "a" }, 1: { v: "b" } },
      1: { 0: { v: "c" }, 1: { v: "d" } },
    });
  });

  it("maps quoted fields with embedded commas to a single cell", () => {
    const sheet = firstSheet(parse(csvToUniverSnapshotJson("\"a,b\",c")));
    expect(sheet.columnCount).toBe(2);
    expect(sheet.cellData[0]![0]!.v).toBe("a,b");
    expect(sheet.cellData[0]![1]!.v).toBe("c");
  });

  it("omits empty cells from the sparse matrix but still sizes columns", () => {
    const sheet = firstSheet(parse(csvToUniverSnapshotJson("a,,c")));
    expect(sheet.columnCount).toBe(3);
    expect(sheet.cellData[0]).toEqual({ 0: { v: "a" }, 2: { v: "c" } });
  });

  it("applies the workbook name", () => {
    expect(parse(csvToUniverSnapshotJson("a", "Data")).name).toBe("Data");
  });

  it("throws on empty or whitespace-only input", () => {
    expect(() => csvToUniverSnapshotJson("")).toThrow();
    expect(() => csvToUniverSnapshotJson("   \n  ")).toThrow();
  });
});
