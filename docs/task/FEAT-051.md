# FEAT-051 - Registry-based CLI: every command a versioned script file

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

Operational scripts ship INSIDE the release binary and version with it. Owner
correction (same day): no separate `cli-scripts/` library with a `script:run`
runner — the whole CLI moves to `apps/api/src/cli/` where EVERY subcommand
(long-lived tooling and one-shot scripts alike) is one file registered in a
single registry. Adding / modifying / retiring any command is one file plus
one registry line.

## Design

- `apps/api/src/cli/`: `index.ts` (cac dispatcher driven by the registry),
  `types.ts` (CliCommand contract: signature, options, run → exit code),
  `registry.ts` (the shipped list), `runtime.ts` (shared offline runtime:
  loadConfig + wireRuntime + close), one file per command.
- Ported as-is: `healthcheck`, `migrate --check`, `backup:export`,
  `backup:import`, `backup:blob-rescan`.
- One-shot scripts use the `script:` name prefix, must be idempotent /
  resumable, and offer `--dry-run`. First entry:
  `script:rekey-legacy-blobs` (closes CHORE-004).
