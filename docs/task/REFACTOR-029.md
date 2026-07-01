# REFACTOR-029 Rework Univer sheet editing: drop edit-lock, version-only autosave with settable display version

- Status: Proposed
- Plan: [PLAN-099](../plan/PLAN-099.md)
- Owner: local-session
- Updated: 2026-07-01

## Goal

Remove the exclusive edit-lock + shared live-content draft model for Univer
spreadsheets (the source of the "sheet cannot open / edit / save" problems and
of dirty shared state). Replace it with a lock-free, version-only model: every
save is an immutable version; editors autosave a new version every 2 minutes (or
manually); the entry designates a "display version" (default = latest by ULID)
that everyone else / preview / download / share sees.

## Scope

Behavioral rework of the drive sheet editing subsystem. **No backward
compatibility** — existing `current_content_body` drafts and old versions are
not migrated; a DB reset/reseed is required.

### Remove
- Edit lock: `editLockId/By/At` columns, `POST/PATCH/DELETE /drive/entries/:id/edit-lock`,
  `acquireEditLock/heartbeatEditLock/releaseEditLock`, and all frontend lock UI
  (mode/lockBy/editId, heartbeat, release beacon, beforeunload release, take-over).
- Live-content draft: `currentContentBody` column, `PATCH /drive/entries/:id/live-content`,
  `updateEntryLiveContent`. No shared mutable slot ⇒ no dirty data.
- "Save as version" as a distinct action — every save is a version.

### Add / change
- **Autosave = new version**: the editor creates a new immutable version every
  2 minutes while there are unsaved changes, on a manual "Save" button, and a
  flush on close if dirty. Skip when content is unchanged since the last version.
- **ULID-ordered versions**: `drive_file_versions.id` becomes a ULID (time
  sortable); "latest" = max ULID. `versionNo` kept only as a display label.
- **Settable display version**: `driveEntries.displayVersionId` (nullable). `null`
  ⇒ display = latest ULID version (auto-follows newest); set ⇒ that pinned
  version is authoritative for open / preview / download / share. Set via the
  existing version-switch endpoint + version-history dialog ("set as display" /
  "use latest").
- **Editability by capability, not lock**: the editor is editable when the actor
  has the `update` capability; otherwise read-only (viewers). No lock involved.
- Content read (`buildDriveEntryDownloadResponse`): drop the `currentContentBody`
  branch; serve the display version's blob (latest when unpinned).

## Acceptance

- Opening a sheet never blocks on a lock and never shows a "locked by X" state;
  it loads the display version and is editable when the actor can update.
- Editing autosaves a new version at most every 2 minutes; a manual Save creates
  a version immediately; closing with unsaved changes flushes one final version.
- Two users editing concurrently never clobber a shared slot: each save is its
  own immutable version; the latest (or pinned) version is what others see.
- Setting a display version pins what preview/download/share/other openers get;
  clearing it returns to latest.
- `bun run check` EXIT 0. No edit-lock / live-content endpoints remain in the
  spec.

## Notes

- Tradeoff (accepted): no real-time merge. An editor based on version N who saves
  after another user saved N+1 produces a newer version that becomes "latest",
  logically overwriting the display — but every version is preserved in history,
  so nothing is lost (no dirty data).
- Requires a new release (v0.1.9) to reach the online deployment; the current
  lock/live-content code is byte-identical between v0.1.8 and HEAD, so this is a
  net-new fix commit, not a revert.
