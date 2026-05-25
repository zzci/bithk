# FEAT-010 Complete missing drive file manager features

- **status**: done
- **priority**: P1
- **owner**: Codex
- **createdAt**: 2026-05-25 00:38

## Description

Complete the missing drive file manager features identified during the current implementation review.

Acceptance criteria:

1. Folder upload is available from the drive browser and uploads nested files into matching folders.
2. Drive entries can be moved with direct drag-and-drop inside the browser.
3. Drive search can query beyond the currently loaded folder, with clear UI scope.
4. Image entries can show actual thumbnails where the backend can serve them safely.
5. File version history is reachable from the preview or item actions, and users can switch the current version.

## ActiveForm

Completing missing drive file manager features

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Created after reviewing the current drive implementation. The work crosses frontend drive surfaces, API routes/services, tests, and documentation, so it is tracked by PLAN-014.

2026-05-25 00:40 — Implementation approved for the full scope.

2026-05-25 01:10 — Completed the full scope:

- Recursive folder upload creates missing nested folders and uploads files into
  the matching tree.
- File list entries can be moved by dragging one or more selected items onto a
  folder or the current folder surface.
- Drive browser search now exposes current-folder and drive-wide scopes.
- Image files render grid thumbnails through the existing inline content route
  with icon fallback.
- File version history is available from item actions and the preview dialog,
  including switch-current support for writable users.

Verification:

- `bun run typecheck`
- `bun run lint`
- `bun run check:i18n`
- `bun run check:env-docs`
- `bun run check:api-docs`
- `bun run build`
- `bun run test`
- `bun --env-file=/dev/null test ./src/modules/drive/drive.test.ts ./src/modules/drive/drive.service.test.ts ./src/modules/drive/drive.version.service.test.ts`
- `bunx vitest run src/app/routes/_app/-file-preview-dialog.test.ts src/app/routes/_app/-drive-file-picker.test.tsx src/app/routes/_app/-file-browser-types.test.ts`
