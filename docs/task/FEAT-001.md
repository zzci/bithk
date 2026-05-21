# FEAT-001 — Drive page assembly, i18n, create-owner wiring, e2e

- **Status:** Done
- **Plan:** [PLAN-001](../plan/PLAN-001.md)
- **Created:** 2026-05-21
- **Branch:** `bkd/9ia7fzaw`

## Scope

Final assembly of the drive frontend on top of the merged backend and
components.

## Changes

- `apps/web/src/app/routes/_app/portal/drive.lazy.tsx` — replaced the
  single-page browser with a three-tab page (My files / Team directories /
  Shared with me); holds `{ shareEntry, previewEntry }` state and renders
  `ShareDialog` + `FilePreviewDialog` from the `FileBrowser` callbacks.
- `apps/web/src/locales/en/drive.json`, `.../zh/drive.json` — rewritten to
  cover every `browser.*`, `share.*`, `team.*`, `preview.*`, `picker.*`, and
  `page.*` key the components use; superseded single-page baseline keys
  removed; en/zh key sets identical.
- `apps/web/src/shared/lib/api/drive.ts` — `useCreateDriveFolder` /
  `useCreateTextFile` accept optional `{ ownerType, ownerId }` and forward
  them in the POST body.
- `apps/web/src/app/routes/_app/portal/-file-browser.tsx` — passes the
  browser's owner into the create-folder / create-text-file calls.
- `tests/e2e/modules/drive/team-directories.test.ts` — added the
  owner-scoped listing + create-by-role matrix case.
- `docs/modules/drive.md` — documented the create-owner gating, the
  three-tab UI, the `DriveFilePicker` import path, and the new e2e case.

## Verification

- `bun run check` — lint / typecheck / test / build / check:i18n /
  check:env-docs / check:api-docs all pass.
- `bun run test:e2e` — 72/72 module tests pass (includes the new case).
