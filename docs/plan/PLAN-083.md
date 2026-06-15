# PLAN-083 - Backup CLI import/export + e2e round-trip

- Status: Completed
- Task: [FEAT-033](../task/FEAT-033.md)
- Campaign: local
- Created: 2026-06-15

## Context

Backup v2 (FEAT-023 / PLAN-075) exposes export/import only over the authenticated
HTTP API. An operator restoring onto a fresh or broken install therefore has no
offline path: the server must already be running and logged in before a backup
can be imported. A packaged release should be able to export and import an
archive straight from the binary, the same way `migrate` / `healthcheck`
already run as non-bootstrap subcommands.

The backup services are reusable as-is — `writeArchiveV2` (export),
`prepareImport` + `startImportApply` (import) — but they need a database and the
file-storage driver wired up. The CLI must not start the HTTP server, cron, or
the audit / backup-staging / file-GC sweeps: an offline command racing those
sweeps could corrupt or contend on the very data it is reading or writing.

## Proposal

1. Offline runtime (`apps/api/src/app.ts`):
   - Add `wireRuntime(config, logger)` returning `{ db, close }`. It opens the
     migrated database (`createDb` migrates) and runs `initFileModule(config)`
     to select the storage driver (needed even with zero blobs), but starts no
     background workers and no HTTP server.
   - Module backup registrations (`registerBackupContribution`) are an import
     side-effect of `app.ts`'s barrel imports, so importing `app.ts` already
     populates every module's contribution — no explicit registration call.

2. CLI subcommands (`apps/api/src/cli.ts`):
   - `backup:export <out>` — `--modules` XOR `--exclude` (validated; both set,
     an empty entry, or an unknown module exits `2`). `writeArchiveV2` expands
     dependencies itself; the command additionally resolves deps to warn when an
     excluded module is pulled back in. `--no-blobs` maps to `blobsMode: "none"`,
     `--redacted` to `redacted: true`. Stages into the backup staging root, copies
     to `<out>`, and reports the byte size.
   - `backup:import <archive>` — `--mode merge|replace` (default `merge`,
     anything else exits `2`), `--include-users`, `--actor-id <id>` (default
     `cli`). Calls `prepareImport` then `startImportApply`, awaits the job, and
     prints `inserted / skippedDuplicate / failed / transformed` on success.
   - All backup-service imports are dynamic so the normal boot path is unaffected.

3. E2e + docs:
   - `tests/e2e/modules/backup/cli-roundtrip.test.ts`: export then import an
     archive and assert the data survives the round-trip.
   - `docs/task/FEAT-033.md`, this plan, the task/plan indexes, the changelog,
     and the optional `scripts/package.ts` passthrough entries.

### Execution DAG

The campaign ran as four lanes:

- **L3-A** — `app.ts` `wireRuntime` offline runtime init (foundation).
- **L3-B** — `cli.ts` `backup:export` + `backup:import` commands, on top of A.
- **L3-C** — e2e round-trip test, on top of B.
- **L3-D** — docs (this plan + FEAT-033 + indexes + changelog), on top of B.

Export and import were combined into one `cli.ts` lane (L3-B) rather than split,
because both subcommands edit the same `cac` dispatcher in the same file — two
lanes would have collided on every edit. C and D both depend on B (the merged
CLI) and were cut after it landed.

## Risks

- An offline command racing a background sweep (audit/backup-staging/file-GC) or
  cron could corrupt or contend on the data it reads/writes. Mitigated by
  `wireRuntime` starting none of them.
- `--mode replace --include-users` can lock the operator out if the chosen
  `--actor-id` is not an active admin present in the backup (FK / lock-out
  refusal). Documented in the command help and FEAT-033; the default `merge`
  mode is non-destructive.
- Adding the subcommands must not perturb the boot path. Mitigated by keeping all
  backup-service imports dynamic and matching the existing dispatcher's
  fall-through contract (`null` when no subcommand matched).

## Verification

- `app backup:export <out>` against a seeded DB produces a v2 archive; flag
  validation exits `2` on bad input.
- `app backup:import <archive>` re-applies the archive in both `merge` and
  `replace` modes and prints the totals.
- `tests/e2e/modules/backup/cli-roundtrip.test.ts` passes (export → import →
  data survives).
- `bun run check` (lint + typecheck + test + routes + build + i18n + docs).
