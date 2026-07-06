# CHORE-004 - Legacy blob re-key migration script (ab/cd/sha -> hour layout)

- Status: Planned
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Scope (deferred by owner decision 2026-07-06)

One-shot operator script that walks `files` rows whose `storage_key` matches the legacy
`ab/cd/<sha256>` shape, copies each object to a fresh `YYYYMMDDHH/<ulid>` key (hour = ULID
timestamp of the row id, so history stays truthful), repoints the row, deletes the old
object, and reports moved/skipped/failed. Idempotent and resumable. Not scheduled — run
manually after the layout release settles.
