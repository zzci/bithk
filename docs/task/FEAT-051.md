# FEAT-051 - Bundled CLI script library (script:list / script:run)

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

Operational one-shot scripts ship INSIDE the release binary as a versioned
script library, so updating the app also updates the scripts; scripts are
added / modified / retired by editing the registry between releases.

## Design

- `apps/api/src/cli-scripts/`: `types.ts` (CliScript contract: idempotent,
  resumable, honours dryRun, exit code 0/1/2), `registry.ts` (the shipped
  list), one file per script.
- CLI: `app script:list` prints the library; `app script:run <name>
  [--dry-run]` runs one against the same offline runtime as the backup CLI
  (`wireRuntime`: DB + storage drivers from DB config, no server).
- First entry: `rekey-legacy-blobs` (closes CHORE-004).
