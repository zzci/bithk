# FEAT-061 Import Excel workbooks as editable spreadsheets while keeping the original file

- **status**: completed
- **priority**: P2
- **owner**: maintenance/session-20260905-xls
- **createdAt**: 2026-09-05

## Description

The drive can turn a CSV into a Univer spreadsheet but has no path for Excel
workbooks: an uploaded `.xlsx` / `.xls` is a download-only blob with no preview
and no editing. Add an import option that converts a picked workbook into the
drive's own sheet format while storing the original workbook untouched beside
it. See [PLAN-115](../plan/PLAN-115.md).

## Acceptance

- Importing a workbook produces two drive entries: the original file and a
  converted `.sheet` entry, in the same folder.
- The converted snapshot preserves every source tab, its name and its cell
  values with correct value types (string / number / boolean).
- Conversion runs client-side in a lazily loaded chunk; the main drive bundle
  does not grow.
- Oversized or unreadable workbooks fail with a toast and create no entries.
- Focused tests cover the workbook-to-snapshot mapping; `bun run check` passes.

- complete: Excel/ODS import ships as a drive toolbar action; the original workbook is uploaded untouched and a converted multi-tab Univer sheet is created beside it. 20 snapshot, 6 reader and 7 browser tests pass; `bun run check` passed end to end.
