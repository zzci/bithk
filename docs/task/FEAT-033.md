# FEAT-033 Backup CLI import/export + e2e round-trip

- Status: Completed
- Plan: [PLAN-083](../plan/PLAN-083.md)
- Owner: local-session
- Updated: 2026-06-15

## Goal

The backup v2 module (FEAT-023) exposes export/import only over the HTTP API,
so an operator restoring onto a fresh or broken install has no offline path —
the server must already be up and authenticated. Add first-class CLI
subcommands that drive the same backup services against a minimal offline
runtime (open, migrated DB + file driver, no background workers, no HTTP
server), so a packaged release can export and import archives directly from the
binary, and lock the round-trip with a live e2e test.

## Scope

- `apps/api/src/app.ts`: add `wireRuntime(config, logger)` — an offline runtime
  init that opens the migrated database and selects the file-storage driver
  without starting the audit / backup-staging / file-GC sweeps, cron, or the
  HTTP server, so the offline commands cannot race those sweeps. Module backup
  contributions register as an import side-effect of the barrel, so importing
  `app.ts` already populates every module's contribution.
- `apps/api/src/cli.ts`: two `cac` subcommands on the existing dispatcher.
  - `backup:export <out>` — `--modules <csv>` XOR `--exclude <csv>` (module
    level; transitive dependencies auto-resolved by the archive writer, and an
    excluded module dragged back in as someone else's dependency is reported as
    a warning), `--no-blobs` (omit blob bytes), `--redacted` (scrub secret-typed
    fields). Reuses `writeArchiveV2`; backup-service imports stay dynamic so the
    normal boot path is unaffected.
  - `backup:import <archive>` — `--mode merge|replace` (default `merge`),
    `--include-users`, `--actor-id <id>` (synthetic actor recorded in the audit
    log). Reuses `prepareImport` + `startImportApply`. `--mode replace
    --include-users` requires `--actor-id` to be an active admin present in the
    backup, otherwise the apply refuses with a lock-out / FK error.
- `tests/e2e/modules/backup/cli-roundtrip.test.ts`: a live round-trip — export
  an archive via `backup:export`, import it via `backup:import`, and assert the
  data survives.
- Optional `scripts/package.ts`: `backup:export` / `backup:import` passthrough
  entries in the packaged `scripts` block alongside `healthcheck` / `migrate`.

Out of scope: scheduled/automatic backups, remote (non-filesystem) archive
destinations, and any change to the HTTP backup routes or the export-job /
import-apply services themselves (the CLI only wires them to an offline runtime).

## Acceptance

- `app backup:export <out>` writes a v2 archive built from the selected modules
  honouring `--modules` XOR `--exclude`, `--no-blobs`, and `--redacted`, exits
  `0` on success, and `2` on bad input (both flags, empty/unknown module).
- `app backup:import <archive>` applies the archive in the requested mode,
  prints the import totals, exits `0` when the job completes and `1` when it
  fails.
- Both commands run against `wireRuntime` only — no HTTP server, cron, or
  background sweep is started, and the DB handle is closed on exit.
- The e2e round-trip (`tests/e2e/modules/backup/cli-roundtrip.test.ts`) exports
  then imports an archive and confirms the data survives.
- `bun run check` passes.

## Notes

- 2026-06-15 - The two subcommands were implemented as a single `cli.ts` lane
  to avoid file overlap (both edit the same dispatcher); `wireRuntime` landed
  first as its own lane so both commands could build on the offline runtime.
  See [PLAN-083](../plan/PLAN-083.md).
