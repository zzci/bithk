// Workbook reading for the drive's "Import Excel" action.
//
// Wraps `hucre` — a zero-dependency, runtime-neutral spreadsheet engine — and
// keeps it behind a dynamic import: `readXlsx` alone is ~34 KB gzipped, and a
// user who never imports a workbook should never download it. The reader is
// picked from the file extension so only the format at hand is fetched;
// `hucre`'s auto-detecting `read()` would pull every reader into one chunk.
//
// Values only. The legacy readers surface sheet names, cell values and merges
// and nothing else, and formulas arrive as their cached result in every format,
// so the caller is expected to keep the original file alongside the conversion.

import type { WorkbookSheetInput } from "./univer-snapshot";

/** DOM `accept` string for the workbook file input. */
export const WORKBOOK_ACCEPT = ".xlsx,.xlsb,.xls,.ods";

const RE_WORKBOOK_EXTENSION = /\.(?:xlsx|xlsb|xls|ods)$/i;

/**
 * Cap on the dense rectangle a single sheet may be normalized into. `hucre`
 * defaults to 20,000,000 cells, which is a server-side number: the array alone
 * budgets ~8 bytes per slot, and this parse runs on the browser's main thread.
 * Crossing it throws, which the caller reports — deliberately not `maxRows`,
 * which would silently truncate the import instead.
 */
const MAX_TOTAL_CELLS = 1_000_000;

/** Strip a known workbook extension, for naming the converted sheet. */
export function workbookBaseName(filename: string): string {
  return filename.replace(RE_WORKBOOK_EXTENSION, "") || filename;
}

/**
 * Whether a filename names a workbook this module can read. Both consumers
 * gate on it: the API refuses to convert anything else, and the web app only
 * offers the convert action on entries it would accept.
 */
export function isWorkbookFilename(filename: string): boolean {
  return RE_WORKBOOK_EXTENSION.test(filename);
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Read a workbook into the tabs `workbookToUniverSnapshotJson` consumes.
 * Throws when the bytes are not a readable workbook of that format, or when a
 * sheet's bounding box exceeds {@link MAX_TOTAL_CELLS}.
 */
export async function readWorkbookSheets(
  filename: string,
  bytes: Uint8Array,
): Promise<readonly WorkbookSheetInput[]> {
  const extension = extensionOf(filename);

  if (extension === "ods") {
    const { readOds } = await import("hucre/ods");
    return (await readOds(bytes, { maxTotalCells: MAX_TOTAL_CELLS })).sheets;
  }

  const { readXls, readXlsb, readXlsx } = await import("hucre/xlsx");
  if (extension === "xls")
    return (await readXls(bytes, { maxTotalCells: MAX_TOTAL_CELLS })).sheets;
  // `maxTotalCells` is not honoured by the xlsb reader, so it is left off
  // rather than passed and quietly ignored.
  if (extension === "xlsb")
    return (await readXlsb(bytes)).sheets;
  return (await readXlsx(bytes, { maxTotalCells: MAX_TOTAL_CELLS })).sheets;
}
