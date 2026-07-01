# PLAN-099 Version-only Univer sheet editing (drop edit-lock + live-content)

- status: Proposed
- createdAt: 2026-07-01
- approvedAt:
- relatedTask: REFACTOR-029

## Context

Univer spreadsheets are the only drive files that use an exclusive edit lock
(`editLockId/By/At`, 90s TTL) plus a single shared live-content draft
(`currentContentBody`) that autosaves every 30s and a separate "Save as version"
action. This is the only file type reporting "cannot open / edit / save"; the
mechanism is also the source of dirty shared state and stuck read-only sessions.
The lock/live-content code is byte-identical between v0.1.8 (online) and HEAD, so
the failure is inherent to the model, not a recent regression.

The user has decided to remove locking entirely and drive everything off
immutable versions (no drafts, no shared live slot), which eliminates both the
lock handling and the dirty-data surface.

Existing pieces reused: `drive_file_versions` (immutable snapshots, `uploadedBy`),
`uploadEntryVersion` (`POST /drive/entries/:id/versions`), and the version-switch
pointer / version-history dialog.

## Goal

Lock-free, version-only sheet editing: every save is an immutable version;
autosave creates a version every 2 minutes (or manual); the entry designates a
display version (default latest by ULID) that preview/download/share/other
openers see. No drafts, no lock, no shared mutable content. No backward compat.

## Proposal

### Data (drizzle-generated migration; no hand-editing)
- `driveEntries`: drop `current_content_body`, `edit_lock_id`, `edit_lock_by`,
  `edit_lock_at`; add `display_version_id text` nullable, FK →
  `drive_file_versions.id` (ON DELETE SET NULL). `null` = follow latest.
- `driveFileVersions.id`: generate as ULID (time-sortable). Keep `versionNo` as a
  UI label only; ordering / "latest" is by ULID id desc.
- No data migration of existing drafts/versions (reset + reseed).

### Backend
- Delete edit-lock routes (`POST/PATCH/DELETE /edit-lock`) and `live-content`
  PATCH; delete `drive.edit-lock.service.ts` (acquire/heartbeat/release/live).
- `resolveDisplayVersion(entry)`: pinned `displayVersionId`, else latest by ULID.
- `buildDriveEntryDownloadResponse`: drop the `currentContentBody` branch; serve
  the display version's blob.
- `uploadEntryVersion`: ULID id; unchanged capability gate (`update` /
  `files.manage`). Optional: skip if the new content hashes identical to the
  display/latest version (dedupe autosave no-ops).
- Rework the version-switch endpoint into "set display version" (pin) + "clear"
  (back to latest); keep listing versions (ULID-ordered) with author + label.

### Frontend (`-univer-sheet-editor-dialog.tsx`)
- Remove all lock state (mode/lockBy/editId, heartbeat, release beacon,
  beforeunload release, take-over, retryEditing, acquire).
- `canEdit` from the `update` capability (passed by the caller, like the team-dir
  `canManage` / project `files.manage`); read-only otherwise. Univer
  `setEditable(canEdit)`.
- Load content from the display version (existing content fetch, which now
  resolves the display version server-side).
- Dirty tracking on `onCommandExecuted` MUTATION. Autosave interval every 120s
  while dirty → create a version (`workbook.save()` → `POST /versions`) → clear
  dirty + stamp "saved HH:MM". Manual "Save" button creates one now. Flush a
  final version on close if dirty (fetch keepalive). Status indicator reduced to
  read-only / saving / unsaved / saved / failed (no lock states).
- Version-history dialog: "set as display version" / "use latest".

### Docs / gates
- Regenerate api-spec + api-routes (edit-lock/live-content gone). Update
  `docs/modules/drive.md`. Replace edit-lock tests with version-autosave +
  display-version tests. `bun run check` EXIT 0.

## Verification

- `bun run check` exits 0 (lint, typecheck, web+api tests, build, i18n,
  api-docs, api-spec, routes) — with edit-lock/live-content endpoints removed
  from the spec.
- Backend tests: create sheet → `POST /versions` (autosave) creates a ULID
  version; content GET serves latest; pin an older version via set-display →
  content GET serves the pinned one; clear → back to latest; version create
  requires `update` (viewer 403).
- Frontend: editor opens editable with `update` capability and read-only without;
  MUTATION marks dirty; the 120s interval and manual Save both POST a version;
  no `/edit-lock` or `/live-content` calls are made.

## Notes

- Accepted tradeoff: no real-time merge; concurrent editors produce independent
  versions and the newest (or pinned) is the display — nothing is lost (full
  version history). Documented in REFACTOR-029.
- Open micro-decisions confirmed with the user: no drafts; autosave every 2 min
  or manual; no "save as version" concept (save == version); settable display
  version defaulting to latest ULID; no backward compatibility.
