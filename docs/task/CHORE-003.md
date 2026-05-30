# CHORE-003 Full-feature static seed dataset

- **status**: completed
- **priority**: P2
- **owner**: seed-script
- **createdAt**: 2026-05-30

## Description

Replace the PRNG-driven seed generator with a curated static JSON dataset plus
an importer, covering every feature module so the app can be demoed and tested
end to end. Seed always resets seed-owned data first (no idempotent skip).

Acceptance criteria:

- `bun run seed` resets prior seed data and imports the static dataset.
- Dataset lives as JSON under `apps/api/scripts/seed/data/`, demo files under
  `apps/api/scripts/seed/assets/` (committed, so covers/attachments are stable
  and work offline).
- Coverage: accounts + groups, contacts, ships + equipment + maintenance
  templates, projects (members/roles/categories/tags/cover/ship binding),
  issues (5 statuses + tags + comments + attachments), procurements (per
  project, statuses + attachments), documents (tree + tags + pins + attachments
  + shares), drive (personal + team directories + folders + uploaded files +
  versions), shares (document/drive_entry, direct + public_link), audit events,
  cron jobs + logs, settings.
- Cross-record links use stable keys resolved to ids by the importer.
- Adding a schema field later means editing the JSON object only.
- `bun run lint` and `bun run typecheck` pass.

## ActiveForm

Building a full-feature static seed dataset and importer.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Research-stage; destructive changes acceptable, data is reset on each seed. See
PLAN-041. Verified creator signatures: share supports only document/drive_entry
resource types with view/download/edit permissions; group via createGroup +
addGroupMember; audit via audit(db, logger, params); policy via createTuple;
settings via setSetting.
