# PLAN-041 Full-feature static seed dataset + importer

- **status**: completed
- **createdAt**: 2026-05-30
- **approvedAt**: 2026-05-30
- **relatedTask**: CHORE-003

## Context

Current `apps/api/scripts/seed.ts` (729 lines) generates data with a seeded
PRNG. User wants a curated static dataset that is stable, reusable, covers every
feature, includes demo files, and resets the DB before each seed so schema
growth only needs field edits.

Verified service creators (entry points the importer will call):
- account: direct `users` insert; `createGroup`, `addGroupMember`
- contact: `contactService.create(db, actor, input)`
- ship: `createShip`, `createEquipment`, `createGlobalTemplate`, `createShipTemplate`, `bindProject`
- project: `createProject`, `addMember`, `createCategory`, `listRoles`
- issue: `createIssue` (tags, status todo/working/review/done/cancel), `resolveIssueItem`
- item: `createComment`
- procurement: `createProcurement`
- document: `createDocument`, `pinDocument`, `addDocumentShare`
- drive: `createDriveFolder`, `uploadDriveFile`, `createDriveTextFile`, `createTeamDirectory`, `addTeamMember`, `uploadEntryVersion`
- file: `uploadAndReference` (ownerType item_attachment / item_comment_attachment / document / drive_entry)
- share: `createShare` (resourceType document|drive_entry; shareType direct|public_link; permission view|download|edit)
- audit: `audit(db, logger, params)`
- policy: `createTuple`
- settings: `setSetting`

## Proposal

New layout under `apps/api/scripts/seed/`:
- `data/*.json` — curated records, each with a stable `key`; cross-refs by key.
- `assets/` — committed demo files (cover images, attachment PDFs/images/text).
- `seed.ts` — importer: reset seed-owned data, then walk JSON in FK order,
  resolve keys → ids, call the matching creator, record produced ids.

Volume strategy (per user): core entities written out statically; high-volume
issues/procurements use JSON templates the importer expands per project.

Reset: always wipe seed-owned rows first (drop the idempotent skip). Keep the
`defer_foreign_keys` transactional wipe; widen it to cover new seed-owned tables
(groups, cron, audit, team directories) via seed-id prefixes / creator filters.

## Risks

- Cover/attachment files committed to repo add ~1-3 MB. Accepted by user.
- share resource types are limited (document/drive_entry only) — do NOT attempt
  issue/procurement shares.
- audit/cron rows have no creator FK to seed users; wipe must match them by a
  seed marker (e.g. actorId/jobId prefix) to stay clean on reset.
- Some creators need full `Config` + `initFileModule` (drive/file uploads,
  covers) — importer loads config once via `loadConfigStrict`.

## Scope

New `apps/api/scripts/seed/` tree (JSON + importer + assets); rewrite/replace
the existing `apps/api/scripts/seed.ts` entry. No schema/migration/business
code changes. Update `package.json` seed script path if needed.

## Alternatives

- Fully static every row (no templates): rejected — hundreds of hand-written
  issue/procurement rows, unmaintainable.
- Keep PRNG generation: rejected — user wants stable reusable data.

## Annotations

- 2026-05-30: Approved. User confirmed (1) template-expansion for high-volume
  issues/procurements and (2) committing demo files into the repo.
