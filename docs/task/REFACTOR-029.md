# REFACTOR-029 Rework Univer sheet editing: drop edit-lock, version-only autosave with settable display version

- Status: Completed
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

## Amendment — session-coalesced idle autosave (2026-07-01)

Follow-up to reduce version churn (approved): the editor no longer appends a new
version on every autosave tick.

Server saves are split from a continuous local save (approved after iterating on
cadence):

- **Server version — idle 2 minutes OR manual only**: a version is written ONLY
  when the sheet has been idle for 2 minutes after the last edit (the timer
  resets on each edit, so continuous editing never triggers it), or on a manual
  Save. Editing non-stop for 10 minutes touches the server 0 times until the user
  pauses (10+2 min) or saves manually. There is no max-wait / forced server save.
- **Local draft — continuous (localStorage)**: while editing, the workbook is
  written to a per-user localStorage draft on a short (~3 s) debounce, plus a
  synchronous flush on close. This is the crash / refresh recovery during a long
  continuous session; closing does NOT create a server version.
- **Restore on reopen**: a local draft (unsaved from a prior crashed / closed
  session) is auto-loaded over the server snapshot, marks the sheet dirty, and
  toasts once ("Restored unsaved changes"). A successful server save clears the
  draft; big snapshots (>2 MB) skip localStorage.
- **Session coalescing**: the first server save of an editing session creates the
  session's version; every later idle / manual save **overwrites that same
  version** in place. One editing session ⇒ exactly one version.
- Backend: `overwriteEntryVersion(entry, versionId, file)` uploads a fresh blob,
  repoints the version row, advances the entry's display pointer only when it was
  showing exactly that version's blob, and releases the previous blob (no orphan
  accrual). New route `PUT /drive/entries/:id/versions/:versionId` (multipart,
  `update` capability). Frontend hook `useOverwriteVersion`; the editor tracks the
  session version id and switches create→overwrite after the first save.
- Verified: `bun run check` EXIT 0 (api 1932 incl. 3 new overwrite tests, web 864).

## Notes

- Tradeoff (accepted): no real-time merge. An editor based on version N who saves
  after another user saved N+1 produces a newer version that becomes "latest",
  logically overwriting the display — but every version is preserved in history,
  so nothing is lost (no dirty data).
- Requires a new release (v0.1.9) to reach the online deployment; the current
  lock/live-content code is byte-identical between v0.1.8 and HEAD, so this is a
  net-new fix commit, not a revert.
