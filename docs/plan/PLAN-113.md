# PLAN-113 Repair persistence and recovery audit findings

- Status: completed
- Approved: 2026-09-04 (user requested fixes after the audit)
- Task: [FIX-075](../task/FIX-075.md)
- Created: 2026-09-04

## Context

The audit passed the existing quality gate (2248 API tests, 1026 web tests)
and 109 API E2E tests, but additional probes exposed inconsistent backup
exports, discarded document drafts, pending webhook deletion, and duplicated
mutations after response loss. Static inspection also found spreadsheet save
completion clearing newer edits and reversed graceful/forced shutdown calls.

## Scope and approach

1. Export every table and blob manifest from one isolated SQLite read snapshot.
   Keep streaming and close the snapshot on success, cancellation, or failure.
2. Preserve active document drafts and their base version across query refreshes.
3. Track spreadsheet save revisions and editing sessions; preserve later edits,
   recovery drafts, and the engine instance across background refreshes.
4. Drain HTTP requests before the shutdown deadline, then force remaining connections.
5. Prune only completed webhook deliveries and resume pending rows after restart.
6. Disable automatic mutation retries; keep safe query retries unchanged.

No dependency upgrades, schema changes, deployment, or Git publication are included.
Long-lived read snapshots may retain WAL pages during export; release them as soon
as database staging finishes. Webhook crash recovery provides at-least-once delivery,
so retries retain the original delivery identifier.

## Verification

- RED/GREEN regressions for concurrent backup writes, draft refresh, in-flight
  spreadsheet edits/close, HTTP draining/timeouts, webhook backlog/restart, and
  response loss after a mutation commits.
- Run affected API and web suites, then `bun run check` and `bun run test:e2e`.

## Progress

- Investigation and proposal completed in the preceding audit; implementation approved.
- RED: backup consistency, webhook backlog/recovery, HTTP draining, document
  refresh, spreadsheet save completion, and mutation response-loss regressions failed.
- GREEN: 27 focused API tests and 20 focused web tests passed, including memory
  snapshots, cancellation cleanup, interrupted delivery recovery, spreadsheet
  reopen and explicit version selection. API E2E: 109 passed.
- `bun run check` passed: 2256 API tests, 1034 web tests, lint, type checks,
  production builds, and every documentation/spec/type drift check. API line
  coverage: 93.20%; web line coverage: 55.53% (existing project floors apply).
- Final local diff review passed; no dependency or schema changes. No commit,
  push, or deployment was performed.
