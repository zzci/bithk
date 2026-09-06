# FEAT-062 Convert a stored workbook into a spreadsheet from the server

- **status**: completed
- **priority**: P2
- **owner**: maintenance/session-20260905-xls
- **createdAt**: 2026-09-05

## Description

FEAT-061 converts a workbook only at import time, so the many `.xlsx` / `.xls`
files already sitting in the drive have no path to an editable spreadsheet.
Add a server-side conversion endpoint and a drive row action that uses it,
leaving the source file untouched. See [PLAN-116](../plan/PLAN-116.md).

## Acceptance

- `POST /drive/entries/:id/convert-to-sheet` creates a `.sheet` sibling in the
  source entry's folder and leaves the source entry unchanged.
- Conversion logic is shared with the import path, not duplicated per app.
- Non-workbook entries, folders, and blobs over the upload cap are refused
  without creating anything.
- The endpoint is gated by the same policy check as other drive mutations and
  writes an audit record.
- Focused tests cover the service and route; `bun run check` passes.

- complete: Conversion core promoted to `@app/spreadsheet`; `POST /drive/entries/:id/convert-to-sheet` plus a drive row action ship on top of it. 28 package, 64 drive, 1023 web tests and `bun run check` passed; browser acceptance 5/5.
