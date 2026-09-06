# PLAN-116 Server-side workbook conversion for stored drive files

- Status: completed
- Approved: 2026-09-05 (user: 增加A 来走服务端转换)
- Task: [FEAT-062](../task/FEAT-062.md)

## Context and scope

FEAT-061 shipped alternative "import-time conversion": the browser reads the
picked workbook, uploads the original, and creates the converted `.sheet`.
Workbooks already stored in the drive have no conversion affordance at all —
alternative A from that plan, now approved.

Relevant existing shape:

- `createDriveSpreadsheet` (`drive.service.ts:650`) already persists a Univer
  snapshot as a normal drive entry with `UNIVER_SHEET_MIME`, on the `db` driver.
- `buildDriveEntryDownloadResponse` (`drive.service.ts:886`) shows the blob
  lookup chain: entry → `getReferenceById` → `getFileById` →
  `getDriver(file.storageDriver)`. Per-row driver resolution matters — blobs
  live on `db`, `local` or `s3`.
- Per-entry mutations gate on
  `driveAccess.assert(policyContext(c)!, "drive:update", id)` then
  `getEntryOwner(db, id)`.
- The conversion core (`workbookToUniverSnapshotJson`) and the hucre reader
  dispatch (`readWorkbookSheets`) currently live in `apps/web`.

## Proposal

### 1. Promote the conversion core to a shared package

A second consumer makes the web-local copy wrong. Move both modules into a new
workspace package `@app/spreadsheet` (`packages/spreadsheet`), with `hucre` as
its dependency instead of `apps/web`'s. The workspace already globs
`packages/*`, and `/pma`'s monorepo guidance names "genuinely shared by
multiple consumers" as the justification for a package.

The package exports the existing surface unchanged — `emptyUniverSnapshotJson`,
`csvToUniverSnapshotJson`, `parseCsv`, `workbookToUniverSnapshotJson`,
`readWorkbookSheets`, `workbookBaseName`, `WORKBOOK_ACCEPT` — so the web change
is an import-path swap. Their tests move with them.

### 2. Endpoint

`POST /drive/entries/:id/convert-to-sheet` → 201 with the created `DriveEntry`.

- Gate: `drive:update` on the source entry, then `getEntryOwner`.
- Refuse a folder or an entry with no file (`INVALID_ENTRY_TYPE`, 400).
- Refuse an extension outside `.xlsx` / `.xlsb` / `.xls` / `.ods`
  (`UNSUPPORTED_FORMAT`, 400).
- Refuse a blob larger than `MAX_UPLOAD_BYTES` (`FILE_TOO_LARGE`, 400) — the
  parse happens in the API process, so the upload cap governs it.
- Read the blob through the source row's own driver, convert, and create the
  sheet in the source's parent folder as `<base>.sheet` via
  `createDriveSpreadsheet`. The source entry is never written to.
- Audit `drive.file.created` on the new entry, matching the existing
  spreadsheet route.

### 3. Web

A row action "Convert to spreadsheet" in the drive list `getCustomActions`,
shown for entries whose name carries a workbook extension. On success the new
sheet opens in the editor, as the import path already does.

The import flow keeps converting client-side: switching it to upload-then-
convert would need `enqueueUploads` to stop being fire-and-forget, which is
outside this task. Both paths call the same shared code, so there is one
implementation either way.

## Risks

- Parsing moves onto the API event loop. Bounded by the existing
  `maxTotalCells` cap and the upload-size refusal; a very large workbook still
  occupies a request for the duration of the parse.
- `hucre` becomes an API runtime dependency. It is zero-dependency, ESM and
  runtime-neutral, and already runs under Bun in the web test suite.
- Moving modules between workspaces touches import paths in the web app; the
  risk is mechanical (typecheck catches it), not behavioural.
- Repeated conversion creates repeated siblings. Name collisions surface as the
  existing duplicate-name error rather than silently overwriting.

## Scope

- `packages/spreadsheet/` — new package (moved sources + tests, `hucre` dep)
- `apps/web` — import-path swap, drop the `hucre` dep, add the row action + i18n
- `apps/api` — `convertDriveEntryToSheet` service + route + tests
- No schema, migration or backup-registry change

## Results

- `packages/spreadsheet` (`@app/spreadsheet`) now owns `univer-snapshot.ts` and
  `workbook-import.ts` plus their tests, moved with `git mv` so history follows.
  `hucre` moved from `apps/web` to the package; the web app depends on the
  package and swapped its import paths. 28 tests pass there (26 moved, 2 new
  for the added `isWorkbookFilename` predicate the API and the row action
  both gate on).
- The moved tests switched from `vitest` to `bun:test`, which is stricter about
  `noUncheckedIndexedAccess`: three `toBe(snapshot.sheetOrder[n])` assertions
  needed a non-null assertion. No behaviour change.
- RED: five `convertDriveEntryToSheet` cases failed on the missing export.
  GREEN: the service reads the source blob through **its own** driver
  (`getDriver(file.storageDriver)`, not the active one) so db / local / s3
  sources all convert, and creates the sheet via the existing
  `createDriveSpreadsheet`. 34 service and 30 route tests pass.
- Route `POST /drive/entries/:id/convert-to-sheet` gates on `drive:update` for
  the source entry, audits `drive.file.created`, and returns 201 with the new
  entry. Quarantined blobs return the existing content-unavailable error rather
  than a 500 from driver lookup.
- Deviation: the route test asserts status 400 only, not the error code — the
  drive route harness's error envelope is `{"success":false}` with no body.
  The exact codes (`INVALID_ENTRY_TYPE`, `UNSUPPORTED_FORMAT`,
  `FILE_TOO_LARGE`) are pinned in the service tests instead.
- `apps/api` took `hucre` as a **dev** dependency, used only to write workbook
  fixtures in tests; the runtime path reaches it through `@app/spreadsheet`.
- Root `lint` now covers `packages/` — the moved sources would otherwise have
  left the linter's reach.
- Regenerated `api-routes.md`, `api-spec.json` and the web API types for the
  new route.
- `bun run check` passed: lint (0 errors, 17 pre-existing warnings), typecheck
  across all three workspaces, `@app/spreadsheet` 28, web 1023 across 139 files,
  the API suite, both builds, and every doc-drift check.
- `bun run test:browser` passed 5/5 against the production build.
- The import path still converts client-side; both paths call the shared
  package, so there is one implementation either way.
