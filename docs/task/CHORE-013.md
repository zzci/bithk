# CHORE-013 - Delete the v1 JSON backup services and port their test harness to v2

- Status: In Progress
- Plan: -
- Owner: audit-remediation/session-2026-09-01
- Created: 2026-09-02

## Goal

FIX-072 retired the v1 JSON backup routes but kept `export.service.ts`
(`streamJsonBackup`) and the v1 half of `restore.service.ts`
(`validateBackupData`, `importJsonBackup`, the migrator chain) because five
test files used them as a round-trip harness. The user asked for the v1 code
to go entirely: port those tests onto the v2 archive services and delete the
dead code.

## Scope

- Shared test helper: export selected modules from one DB with
  `writeArchiveV2`, import into another with the v2 staging/apply path.
- Port `contact` / `procurement` / `ship` / `project` backup tests and the
  v1-vs-v2 comparison in `archive.service.test.ts`; trim
  `restore.service.test.ts` to what survives.
- Delete `export.service.ts`; strip `restore.service.ts` to the live v2
  dependencies (`assertSane`, `assertIdShape`, row caps,
  `reconcileRestoredFiles`); fix imports, docs and the changelog.
- Push `main` and watch CI.

## Verification

- `grep -rn "streamJsonBackup\|importJsonBackup\|validateBackupData"` finds
  nothing outside the changelog.
- `bun run check` EXIT 0, `bun run test:e2e` green, GitHub CI green.
