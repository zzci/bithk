// Pure builders for Univer workbook snapshots.
//
// This module produces the `IWorkbookData` JSON shape that the lazy
// spreadsheet editor parses and hands to Univer at creation time, plus CSV and
// workbook importers that map a spreadsheet file into the same shape. It is
// intentionally
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
const SHEET_NAME = "Sheet1";
/** Univer `CellValueType` members, as literals (no enum import, to stay univer-free). */
const CELL_TYPE_NUMBER = 2;
const CELL_TYPE_BOOLEAN = 3;

/** Positional sheet id — `sheet-01`, `sheet-02`, … in source tab order. */
function sheetIdAt(index: number): string {
  return `sheet-${String(index + 1).padStart(2, "0")}`;
}
/** Fallback workbook name when the caller does not supply one. */
const DEFAULT_NAME = "Untitled";
/** Dimensions of a fresh, empty spreadsheet. */
const EMPTY_ROW_COUNT = 100;
const EMPTY_COLUMN_COUNT = 26;

/**
 * A single Univer cell: the raw value (`v`), plus an explicit `t` for values
 * that are not strings. Univer treats a missing `t` as text, which is what
 * every CSV field is, so the tag is only paid for where it changes meaning.
 */
interface SnapshotCell {
  readonly v: string | number | boolean;
  readonly t?: number;
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
  readonly sheets: readonly SnapshotSheet[];
}): WorkbookSnapshot {
  return {
    id: WORKBOOK_ID,
    name: opts.name,
    appVersion: APP_VERSION,
    locale: SNAPSHOT_LOCALE,
    styles: {},
    sheetOrder: opts.sheets.map(sheet => sheet.id),
    sheets: Object.fromEntries(opts.sheets.map(sheet => [sheet.id, sheet])),
  };
}

/** Wrap one grid as the sole tab of a workbook. */
function singleSheet(rowCount: number, columnCount: number, cellData: SnapshotCellData): SnapshotSheet {
  return { id: sheetIdAt(0), name: SHEET_NAME, rowCount, columnCount, cellData };
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
    sheets: [singleSheet(EMPTY_ROW_COUNT, EMPTY_COLUMN_COUNT, {})],
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
    sheets: [singleSheet(rowCount, columnCount, rowsToCellData(rows))],
  }));
}

/**
 * One cell of an imported workbook. Structurally identical to the `CellValue`
 * union the `hucre` readers produce, restated here so this module keeps its
 * no-spreadsheet-library dependency and stays cheap to import.
 */
export type WorkbookCellValue = string | number | boolean | Date | null;

/** One tab of an imported workbook: its name and its dense value rectangle. */
export interface WorkbookSheetInput {
  readonly name: string;
  readonly rows: readonly (readonly WorkbookCellValue[])[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Render a workbook date as text. Spreadsheet dates are wall-clock values that
 * the readers decode against a UTC epoch, so they are formatted in UTC — a
 * local render would shift every date by the viewer's offset. A midnight time
 * is dropped so a plain date does not grow a meaningless `00:00:00`.
 */
function formatWorkbookDate(value: Date): string {
  const day = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  const hours = value.getUTCHours();
  const minutes = value.getUTCMinutes();
  const seconds = value.getUTCSeconds();
  if (hours === 0 && minutes === 0 && seconds === 0)
    return day;
  return `${day} ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Map one workbook cell, or `null` when it carries nothing worth storing. */
function toSnapshotCell(value: WorkbookCellValue): SnapshotCell | null {
  if (value === null || value === "")
    return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? { v: value, t: CELL_TYPE_NUMBER } : null;
  if (typeof value === "boolean")
    return { v: value, t: CELL_TYPE_BOOLEAN };
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : { v: formatWorkbookDate(value) };
  return { v: value };
}

function resolveSheetName(name: string, index: number): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : `Sheet${index + 1}`;
}

/**
 * Serialize an imported workbook as a Univer snapshot: every source tab is kept
 * in its original order, sized to its dense rectangle, with blanks left out of
 * the sparse matrix. Tabs Univer cannot fill (a chart sheet, an untouched
 * worksheet) become blank sheets so the tab bar still lines up with the source.
 *
 * Throws when the whole workbook holds no values, so the caller can surface the
 * same "nothing to import" error the CSV path uses.
 */
export function workbookToUniverSnapshotJson(
  sheets: readonly WorkbookSheetInput[],
  name?: string,
): string {
  let cellCount = 0;

  const mapped = sheets.map((sheet, index) => {
    const cellData: SnapshotCellData = {};
    let columnCount = 0;

    sheet.rows.forEach((row, r) => {
      columnCount = Math.max(columnCount, row.length);
      row.forEach((value, c) => {
        const cell = toSnapshotCell(value);
        if (!cell)
          return;
        (cellData[r] ??= {})[c] = cell;
        cellCount += 1;
      });
    });

    const blank = sheet.rows.length === 0;
    return {
      id: sheetIdAt(index),
      name: resolveSheetName(sheet.name, index),
      rowCount: blank ? EMPTY_ROW_COUNT : Math.max(1, sheet.rows.length),
      columnCount: blank ? EMPTY_COLUMN_COUNT : Math.max(1, columnCount),
      cellData,
    };
  });

  if (cellCount === 0)
    throw new Error("Workbook contains no cell values");

  return JSON.stringify(buildWorkbookSnapshot({ name: resolveName(name), sheets: mapped }));
}
