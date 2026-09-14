# FEAT-063 Step through previewable files from inside the preview dialog

- **status**: completed
- **priority**: P3
- **owner**: session-20260914-preview-nav
- **createdAt**: 2026-09-14

## Description

The drive preview dialog shows exactly one entry. Looking at a folder of images
or PDFs means closing the dialog, finding the next row, and reopening it. Give
the dialog previous/next affordances scoped to the entries of the list it was
opened from. See [PLAN-117](../plan/PLAN-117.md).

## Acceptance

- Opening a file from a drive folder listing shows previous/next controls when
  that listing holds more than one previewable file.
- Navigation follows the list's visible order and is disabled at both ends.
- Left/right arrow keys move between siblings; they stay inert while editing a
  text/markdown file or while an input has focus.
- Folders and Univer spreadsheets are excluded from the navigation sequence.
- Lists with no sibling context (recent, favorites, share pages, attachments)
  keep the current single-entry dialog with no navigation controls.
- Switching entries loads the new file's bytes and drops the previous view
  state (zoom, rotation, page, edit mode).
- `bun run check` passes.

- complete: Preview dialog gained `siblings` / `onNavigate`; sequence rules live in `file-preview-nav.ts`, wired from the drive chokepoint and the file browser. 1029 web tests and `bun run check` passed.
