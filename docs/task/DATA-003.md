# DATA-003 - Fold the production database into the section model

- Status: Completed (2026-09-02)
- Plan: [PLAN-108](../plan/PLAN-108.md)
- Created: 2026-09-01

## Goal

A real pre-fold database exists and must be carried into the post-PLAN-108
schema. The schema epoch reset (PLAN-108, "no migration script") was decided
when no data worth keeping was known; that is no longer true. Convert
`data/app.db` (3.1 MB; 35 projects, 28 ships, 29 users, 230 items, 803 files,
882 file references, 766 drive entries, 24 equipment rows) into a new file
`data/app-new.db` built on the current baseline, with a reconciliation report.

The source is already at the pre-fold final schema — its single migration hash
equals the pre-fold build's `0000_fluffy_zaladane.sql` — so no intermediate
migration step is needed. The conversion is one fold, not two steps.

## Decisions (2026-09-01)

- Blob storage is **not** touched or verified: 782 of 803 files live on S3, 8
  local, 13 inline. Keys are content-addressed and unchanged by the fold; the
  old store is reused as-is.
- The 8 local blobs are not on this machine. Accepted: they stay referenced
  and are listed in the report as dangling.
- User identities (gid.io OIDC subs, virtual users) are preserved verbatim.
- Output is handed back as `data/app-new.db`; the source file is never written.
- Runtime target: Bun 1.4.0. `MAX_UPLOAD_MB` takes the new default (200).

## Fold rules

1. Every surviving project gets `project_sections` rows for `issues`,
   `procurement`, `files`.
2. Each `ships` row becomes a `ship_profiles` row keyed by `base_project_id`
   (`hull_number` from `ships.code`, `ship_status` from `ships.status`, the
   maritime columns) plus `ship-profile` / `equipment` / `worklist` section
   rows. `ships.description` fills `projects.description` only when the base
   project's is empty. A ship whose `base_project_id` is NULL is a **hard
   error** — it must never be dropped silently.
3. `ship_equipment`, `ship_equipment_categories`, `worklists`: `ship_id` becomes
   the ship's `base_project_id` (global worklists keep NULL).
4. `tags_refs` rows of tag type `ship`: `resource_id` becomes the base project
   id and the type becomes `project`, de-duplicated against the composite key.
5. `file_references` with `owner_type = 'ship_cover'` (13 rows) become
   `project_cover` on the base project; `projects.cover_reference_id` is filled
   only when it was NULL, and a displaced reference is reported, not deleted.
6. Projects bound to a ship but not its base (1 row) get `parent_id` = the base
   project; base projects get `parent_id = NULL`; `projects.ship_id` is dropped.
7. `groups.modules` (one group carries `"ships"`), the `account.default_modules`
   settings row if present, and `api_tokens.scopes` (0 rows) have `ships`
   rewritten to `projects`, merged not appended.
8. Nothing else is dropped. Every other table is copied verbatim in the FK-safe
   order the backup registry already computes.

## Verification

- The output opens under the current build's `migrate()` and reports nothing
  to migrate.
- The seed's section mount-integrity check passes against the output.
- The reconciliation report lists, per table: source rows, written rows,
  rewritten rows, skipped rows with reasons; the script exits non-zero on any
  unexplained row loss.
- Spot checks in the report: 28 `ship_profiles`, 28 ship projects carrying all
  six sections, 1 sub-project, 13 project covers gained, the `user` group's
  modules with `projects` and no `ships`, 8 dangling local blobs enumerated.
- `bun run check` EXIT 0 (the script lives under `apps/api/scripts/**`, which is
  inside the typecheck target).

## Cutover runbook (decided 2026-09-02)

1. Take a fresh copy of the production `app.db`; never run against the live
   file.
2. `bun run --filter @app/api db:fold -- --from <copy> --to <target>` and read
   the reconciliation report; `FOLD_EXIT` must be 0.
3. Clear auth transient state in the target so old logins do not survive:
   `DELETE FROM sessions; DELETE FROM pkce_challenges; DELETE FROM auth_lockouts;
   DELETE FROM totp_challenges;` then `VACUUM`. `user_totp_devices` stays.
4. Keep the 4 orphan `ship_cover` references and the 15 soft-deleted ships
   (carried as soft-deleted general projects) — accepted as-is.
5. Env: drop `MAX_UPLOAD_BYTES` (new `MAX_UPLOAD_MB` defaults to 200); S3 config
   unchanged; Bun 1.4.0.
6. Swap the file, boot, take a fresh format-3 backup immediately.
