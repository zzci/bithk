# FEAT-055 - Aggregated trash: sidebar lists all accessible spaces' trash

- Status: Completed
- Plan: -
- Created: 2026-07-10

## Goal (user-approved plan A)

Deletion is soft everywhere, so the sidebar trash should act as the user's
one recovery surface: personal trash plus the trash of every project and
team directory the caller can view, so any mistaken deletion is manually
restorable from one place. Emptying from the sidebar stays personal-only;
real (permanent) deletion of project files keeps living in the project's
own trash view (per-entry delete-forever and files.manage-gated empty,
shipped in FIX-070).

## Scope

API:

- `listTrashedDriveEntriesForOwners(db, owners)`: multi-owner variant of
  the FIX-070 trash-roots query (single query, owner OR-clause);
  `listTrashedDriveEntries` delegates to it.
- `GET /drive/entries/trash/all`: resolves the caller's visible owners —
  personal + member team directories + member projects holding
  `files.view` (Guest-role members excluded) — and returns aggregated
  trash roots with an `ownerName` (null for personal) for display.

Web:

- `useAllTrashedEntries()` hook against the new endpoint.
- Sidebar trash view switches to it; the list's owner column shows the
  owning space (My files / project name / directory name) instead of the
  creator, which matches the data model's owner semantics.
- Restore / delete-forever stay per-entry and server-authorized; a
  view-only project member hitting restore gets the server's 403 in the
  error banner.

Out of scope: automatic trash expiry; `trashedBy` attribution (would need
a schema migration).

## Verification

- Route tests: aggregation across personal/project/team with owner names,
  foreign users' trash excluded, Guest-capability project excluded (29
  drive route/service tests green).
- Web hook test: aggregated endpoint; touched web suites 475 pass.
- `bun run check` EXIT 0.

## Notes

- `ProjectView.id` is the external shortId while `drive_entries.owner_id`
  stores the internal ULID — the route resolves each via
  `resolveProjectId` before the capability check and owner clause.
