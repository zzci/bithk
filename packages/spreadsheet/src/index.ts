// Spreadsheet conversion shared by the API and the web app.
//
// `univer-snapshot` is the pure mapping layer (no spreadsheet library, no
// `@univerjs` import) and `workbook-import` is the thin `hucre` reader
// dispatch. Both consumers convert through this one implementation: the web
// app at import time, with the picked file still in the browser, and the API
// when converting a workbook already stored in the drive.

export {
  csvToUniverSnapshotJson,
  emptyUniverSnapshotJson,
  parseCsv,
  workbookToUniverSnapshotJson,
} from "./univer-snapshot";
export type { WorkbookCellValue, WorkbookSheetInput } from "./univer-snapshot";
export { isWorkbookFilename, readWorkbookSheets, WORKBOOK_ACCEPT, workbookBaseName } from "./workbook-import";
