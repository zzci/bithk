// Pure builders for Univer workbook snapshots.
//
// This module produces the `IWorkbookData` JSON shape that the lazy
// spreadsheet editor parses and hands to Univer at creation time, plus a CSV
// importer that maps a CSV file into the same shape. It is intentionally
// FREE of any `@univerjs` import so it stays safe to pull into the main drive
// bundle (the create/import UI builds snapshots without loading the editor's
// heavy spreadsheet engine). The `@univerjs` packages are imported only inside
// the route-level lazy chunk.
//
// The emitted JSON matches `@univerjs/core`'s `IWorkbookData`: a workbook with
// `id`, `name`, `appVersion`, `locale`, `styles`, `sheetOrder` and a `sheets`
// map of partial worksheet data (`id`, `name`, `rowCount`, `columnCount`,
// `cellData`). Only the fields Univer needs to materialize a sheet are set;
// Univer fills the rest with its own defaults.

/** Univer model version these snapshots target (kept in sync with the installed packages). */
const APP_VERSION = "0.25.0";
/** Workbook locale, as the literal value of `LocaleType.EN_US` (no enum import to stay univer-free). */
const SNAPSHOT_LOCALE = "enUS";
/** Stable ids — each workbook lives in its own Univer instance, so constants never collide. */
const WORKBOOK_ID = "workbook-01";
const SHEET_ID = "sheet-01";
const SHEET_NAME = "Sheet1";
/** Fallback workbook name when the caller does not supply one. */
const DEFAULT_NAME = "Untitled";
/** Dimensions of a fresh, empty spreadsheet. */
const EMPTY_ROW_COUNT = 100;
const EMPTY_COLUMN_COUNT = 26;

/** A single Univer cell — only the raw value (`v`) is set. */
interface SnapshotCell {
  readonly v: string;
}

/** Sparse row → column → cell matrix (`IObjectMatrixPrimitiveType<ICellData>`). */
type SnapshotCellData = Record<number, Record<number, SnapshotCell>>;

interface SnapshotSheet {
  readonly id: string;
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cellData: SnapshotCellData;
}

interface WorkbookSnapshot {
  readonly id: string;
  readonly name: string;
  readonly appVersion: string;
  readonly locale: string;
  readonly styles: Record<string, never>;
  readonly sheetOrder: readonly string[];
  readonly sheets: Record<string, SnapshotSheet>;
}

function buildWorkbookSnapshot(opts: {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cellData: SnapshotCellData;
}): WorkbookSnapshot {
  return {
    id: WORKBOOK_ID,
    name: opts.name,
    appVersion: APP_VERSION,
    locale: SNAPSHOT_LOCALE,
    styles: {},
    sheetOrder: [SHEET_ID],
    sheets: {
      [SHEET_ID]: {
        id: SHEET_ID,
        name: SHEET_NAME,
        rowCount: opts.rowCount,
        columnCount: opts.columnCount,
        cellData: opts.cellData,
      },
    },
  };
}

function resolveName(name?: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_NAME;
}

/**
 * Serialize a minimal valid empty workbook (one blank {@link EMPTY_ROW_COUNT}×
 * {@link EMPTY_COLUMN_COUNT} sheet). Used to seed a brand-new spreadsheet.
 */
export function emptyUniverSnapshotJson(name?: string): string {
  return JSON.stringify(buildWorkbookSnapshot({
    name: resolveName(name),
    rowCount: EMPTY_ROW_COUNT,
    columnCount: EMPTY_COLUMN_COUNT,
    cellData: {},
  }));
}

/**
 * Parse CSV text into a matrix of string fields. Handles quoted fields,
 * embedded commas, escaped `""` quotes, and CRLF/LF/CR line endings. A
 * trailing newline does not produce a spurious empty final row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i++;
        }
        else {
          inQuotes = false;
        }
      }
      else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
    }
    else if (ch === ",") {
      row.push(field);
      field = "";
    }
    else if (ch === "\n" || ch === "\r") {
      // Consume the LF of a CRLF pair so it ends one row, not two.
      if (ch === "\r" && text[i + 1] === "\n")
        i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    }
    else {
      field += ch;
    }
  }

  // Flush the final field/row unless the input ended exactly on a row break
  // (in which case `field` is empty and `row` was already pushed).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function rowsToCellData(rows: readonly string[][]): SnapshotCellData {
  const cellData: SnapshotCellData = {};
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value === "")
        return;
      (cellData[r] ??= {})[c] = { v: value };
    });
  });
  return cellData;
}

/**
 * Parse CSV text and serialize it as a Univer workbook snapshot sized to the
 * data. Throws when the input is empty (the caller surfaces `csv.empty`).
 */
export function csvToUniverSnapshotJson(csvText: string, name?: string): string {
  if (csvText.trim().length === 0)
    throw new Error("CSV input is empty");

  const rows = parseCsv(csvText);
  if (rows.length === 0)
    throw new Error("CSV input is empty");

  const rowCount = Math.max(1, rows.length);
  const columnCount = Math.max(1, ...rows.map(row => row.length));

  return JSON.stringify(buildWorkbookSnapshot({
    name: resolveName(name),
    rowCount,
    columnCount,
    cellData: rowsToCellData(rows),
  }));
}
