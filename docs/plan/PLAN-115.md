# PLAN-115 Excel workbook import via hucre, original file preserved

- Status: completed
- Approved: 2026-09-05 (user: 开始实现)
- Task: [FEAT-061](../task/FEAT-061.md)

## Context and scope

### Current state

- The drive already owns a spreadsheet format: entries with the
  `application/x-univer-sheet` mimetype whose blob is a Univer `IWorkbookData`
  JSON snapshot (`apps/web/src/shared/lib/univer-snapshot.ts`), created through
  `createDriveSpreadsheet` (`apps/api/src/modules/drive/drive.service.ts:645`)
  and edited in the lazy Univer dialog.
- Only CSV can become a sheet today. `onCsvInputChange`
  (`apps/web/src/app/routes/_app/-file-browser.tsx:248`) reads the picked file,
  calls `csvToUniverSnapshotJson`, and creates the entry. The original CSV is
  discarded — nothing is uploaded.
- Excel workbooks upload fine (the drive accepts any type; only size and
  emptiness are gated in `drive.upload-validation.ts`) but are dead weight:
  `resolvePreviewKind` returns `unsupported` for
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  (`apps/web/src/shared/components/file/file-preview-types.ts`), so the entry is
  a download card and nothing else.
- The snapshot builder is single-sheet and string-only: one hardcoded
  `sheet-01`, and `SnapshotCell` is `{ v: string }`. Univer's `ICellData`
  supports `v: string | number | boolean` plus `t: CellValueType`
  (`STRING = 1`, `NUMBER = 2`, `BOOLEAN = 3`).

### hucre assessment (verified against the published package)

`hucre@1.1.0` is the latest stable on npm (published 2026-08-13), MIT, zero
runtime dependencies, ESM-only, `sideEffects: false`, `engines.node >= 24`
(the repo runs Node 24.20 / Bun 1.4.0).

- `hucre/xlsx` exports `readXlsx`, `readXlsb` **and** `readXls`, so one subpath
  covers `.xlsx`, `.xlsb` and legacy BIFF8 `.xls`. `hucre/ods` adds `.ods`.
- `Workbook.sheets[].rows` is a documented dense `CellValue[][]` with
  `CellValue = string | number | boolean | Date | null` — a direct match for
  Univer's `v` / `t` pair, so the mapping is a pure function over a rectangle.
- Only `dist/cli.mjs` and its bundled citty/consola chunks import `node:`
  builtins. The library entrypoints are runtime-neutral and bundle for the
  browser.
- Documented loss: the legacy readers surface sheet names, cell values and
  merges and nothing else; formulas arrive as their cached value, never as
  formula text. Styles, widths, row heights, named ranges and workbook
  properties are not read. XLSX read is richer but this plan takes values only.
- Size: `{ readXlsx }` is ~34 KB gzipped (upstream CI enforces a budget), so it
  must be dynamically imported, never pulled into the main drive chunk.

### Assumption

"xls" is read as Excel workbooks generally, not the 97-2003 binary format
alone. `hucre/xlsx` gives `.xlsx` / `.xlsb` / `.xls` from a single import, so
covering all three costs nothing extra; `.ods` is included for the same reason.

## Proposal

A new drive toolbar entry, "Import Excel", client-side, mirroring the existing
CSV import path. The original workbook is uploaded through the normal pipeline
and the converted sheet is created beside it, so one import yields two entries:
`Book.xlsx` and `Book.sheet` in the same folder.

1. Add a third hidden `FileUploadButton` in `-file-browser.tsx` with
   `acceptOverride=".xlsx,.xlsb,.xls,.ods"`, and an `onImportExcel` toolbar
   action next to `onImportCsv` in `file-list-toolbar.tsx`.
2. `onExcelInputChange`: upload the picked file through the existing
   `enqueueUploads` pipeline (this is what preserves the original), then
   `await import("hucre/xlsx")`, read the workbook, and
   `createSpreadsheet.mutate({ name: "<base>.sheet", content, … })`, opening the
   new sheet on success — the same shape `onCsvInputChange` already uses.
3. Extend `univer-snapshot.ts` with `workbookToUniverSnapshotJson(sheets, name)`:
   `buildWorkbookSnapshot` takes a sheet array instead of one hardcoded sheet,
   `sheetOrder` follows the source tab order, and a typed cell mapper emits
   `{ v, t: 2 }` for numbers, `{ v, t: 3 }` for booleans, an ISO-style string
   with `t: 1` for `Date`, and skips `null` / `""`. `emptyUniverSnapshotJson`
   and `csvToUniverSnapshotJson` keep their current single-sheet behaviour on
   top of the widened builder.
4. Guard rails: check the file against the configured upload size limit before
   parsing, bound the read with hucre's `maxRows` / `maxTotalCells` so a
   100k-row workbook cannot lock the tab, and surface `excel.empty` /
   `excel.importError` toasts (new `drive` i18n keys, EN and ZH).

## Risks

- **Values only.** Formulas land as their cached value; formatting, column
  widths, merges and named ranges are dropped. This is precisely why the
  original file is kept, and the menu label and success toast should say so.
- **Main-thread parsing.** A large workbook is parsed in the browser. Bounded by
  the size check and the row/cell caps; a Web Worker is deliberately out of
  scope.
- **New web dependency** (`hucre`), ~34 KB gzipped and only inside a lazily
  imported chunk. `apps/web` bundle-size expectations are otherwise unchanged.
- **One-shot snapshot.** Editing the converted sheet does not write back to the
  workbook, and importing the same file twice creates a second pair. Acceptable
  for an import; a sync relationship is not in scope.

## Scope

`apps/web` only. No API route, no schema, no migration, no backup-registry
change (both entries are ordinary drive entries).

- `apps/web/package.json` — add `hucre`
- `apps/web/src/shared/lib/univer-snapshot.ts` + `univer-snapshot.test.ts`
- `apps/web/src/app/routes/_app/-file-browser.tsx`
- `apps/web/src/shared/components/file/file-list-toolbar.tsx`
- `apps/web/src/shared/i18n/locales/{en,zh}/drive.json`

## Alternatives

- **A — server-side conversion.** `POST /drive/entries/:id/convert-to-sheet`
  reads the stored blob, converts on the API, and creates the sheet entry. Works
  for workbooks that are *already* in the drive without a browser round trip and
  keeps the web bundle untouched, at the cost of a new endpoint, permission
  wiring, and CPU on the API event loop. Worth doing as a follow-up if
  converting pre-existing files matters; not needed for the import flow, where
  the bytes are already in the browser.
- **B — per-row "Convert to spreadsheet" action.** Better ergonomics for files
  already stored, but needs the blob in the browser (an extra download) or
  alternative A behind it.
- **C — read-only XLSX preview** instead of conversion. Cheaper, but it does not
  produce an editable sheet, which is the actual request.
- **D — SheetJS / ExcelJS / xlsx-js-style** instead of hucre. ExcelJS is CJS
  with nine dependencies and is not CSP-safe; SheetJS CE is no longer published
  to npm; both are several times larger. hucre is the better fit for an
  ESM + Vite + CSP frontend.

**Recommendation**: ship the toolbar import as proposed, and keep A on the
shelf as a follow-up if converting already-uploaded workbooks is wanted.

## Results

- RED: six new `workbookToUniverSnapshotJson` cases failed against the
  single-sheet, string-only builder (6 failed / 14 passed).
- GREEN: `buildWorkbookSnapshot` now takes a sheet list, `SnapshotCell` carries
  an optional Univer `t`, and `workbookToUniverSnapshotJson` maps a workbook's
  tabs. `univer-snapshot.test.ts` is 20/20; the existing CSV and empty-workbook
  cases keep emitting untagged string cells, so their assertions are unchanged.
- `workbook-import.ts` wraps `hucre` behind a dynamic, extension-dispatched
  import (`hucre/xlsx` for xlsx/xlsb/xls, `hucre/ods` for ods).
  `workbook-import.test.ts` round-trips a real two-tab workbook through
  `writeXlsx` → `readWorkbookSheets` and covers both failure paths, 6/6.
- Deviation from the plan: `maxRows` is **not** passed. It is honoured by the
  xlsx reader only and truncates silently, which would turn an oversized
  workbook into a quietly partial import. Only `maxTotalCells` (1,000,000, down
  from hucre's server-shaped 20,000,000 default) is set — it throws, and the
  caller reports the failure.
- UI: `onImportExcel` threaded through the surface, toolbar menu and blank-area
  context menu alongside `onImportCsv`; a hidden workbook file input in
  `-file-browser.tsx`. Conversion runs before either write, so a workbook that
  cannot be read uploads nothing and creates nothing.
- `-file-browser.test.tsx` covers both legs end to end: a real xlsx lands
  `Budget.xlsx` on the upload queue and POSTs a `Budget.sheet` whose snapshot
  carries both tabs and a numeric cell; an unreadable file toasts and writes
  nothing. 7/7.
- `bun run check` passed end to end — lint (17 pre-existing warnings, zero
  errors), typecheck, API and web suites with the web coverage gate, builds,
  and the i18n / env-docs / api-docs / api-spec / api-types drift checks.
- The build splits `hucre` into its own `xlsx-*.js` chunk at 93.31 kB raw /
  25.35 kB gzipped; no existing chunk grew and no new `>500 kB` chunk appeared.
- No API, schema, migration or backup-registry change: both entries are
  ordinary drive entries.
