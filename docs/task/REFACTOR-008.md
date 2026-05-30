# REFACTOR-008 Normalize the issue status enum end-to-end

- **status**: Completed
- **priority**: P2
- **owner**: l1-xlhyvzyz / L2 issuetag dispatch (L3 6jlf06qn)
- **plan**: -
- **campaignId**: l1-xlhyvzyz-issuetag-20260530164753
- **createdAt**: 2026-05-30

## Description

Replace the issue status enum `open | in_progress | done | cancelled` with the
five-value, ordered enum `todo | working | review | done | cancel` across the
full stack (API schema/zod/service, web types/labels/i18n), plus a data
migration that rewrites existing `items.status` rows where `type='issue'`.

R&D stage: breaking changes are acceptable, no backward-compat shims.

## Proposal (brief)

### Current state

- Issue status lives on the shared `items.status` free-TEXT column (rows with
  `type='issue'`). Current values: `open | in_progress | done | cancelled`.
- API: `IssueStatus` type + `createIssue` default `"open"` (issue.service.ts);
  two zod enums (issue.routes.ts create/update).
- Web: `IssueStatus` type (api/projects.ts, re-used by ships.ts maintenance
  orders); `ISSUE_STATUS_BADGE` (status-colors.ts); the issues tab enum/icon/dot
  maps + `createStatus` default (-project-issues-tab.tsx); `STATUSES` +
  status select (-project-issue-panel.tsx); `STATUS_VARIANTS` + overview/
  maintenance status badges (ships + overview tabs).
- i18n: `projects:issues.status.*` and `projects:issues.group.*` (the rendered
  labels); plus dead `issues.json` `statusOpen/...` keys.
- Migrations run on startup via Drizzle's `migrate()` over `apps/api/drizzle`
  (journal `meta/_journal.json`); 0000–0002 present.

### Proposal

1. Mapping (data migration, `type='issue'` only): open→todo, in_progress→
   working, done→done, cancelled→cancel. `review` is new (no existing rows).
2. Generate the data migration via the project tool — `drizzle-kit generate
   --custom --name=normalize_issue_status` — then fill the UPDATE statements
   (status is free TEXT; no schema diff, so a custom migration is the sanctioned
   path under PMA rule #10). Scoped by `type='issue'` so procurement's own
   `cancelled` is untouched.
3. Swap the enum value/order everywhere; keep the existing status-filter chip
   row in -project-issues-tab.tsx as-is (only values change; removal is a later
   task C). Add a `review` group between `working` and `done`.
4. i18n en+zh: rewrite `projects:issues.status.*` and `projects:issues.group.*`
   to the five values; align the dead `issues.json` keys. Labels — en: To Do /
   In Progress / In Review / Done / Cancelled; zh: 待办 / 进行中 / 待审 /
   已完成 / 已取消.
5. Update API + web + e2e + fixture tests + `seed.ts` to the new enum.

### Risks

- Procurement shares `items` but has its own status set; migration must scope on
  `type='issue'` (verified procurement uses draft/requested/.../cancelled).
- `done` stays `done`; only string churn elsewhere.
- Pre-existing web branch-coverage gate (~3.99%) may keep `check` red
  independent of this change.

### Scope

API: issue.service.ts, issue.routes.ts, new `0003_*` migration; tests
(issue.routes.test.ts, issue.test.ts, item.test.ts, comment(.routes).test.ts as
needed), seed.ts. Web: api/projects.ts, status-colors.ts, -project-issues-tab.tsx,
-project-issue-panel.tsx, ships overview/maintenance tabs, locales en+zh
(projects.json, issues.json), web tests + fixtures, e2e issues.test.ts.

## Acceptance criteria

- `{todo, working, review, done, cancel}` is the ONLY issue status enum anywhere
  (api schema/zod/service + web type/labels/i18n). No leftover open/in_progress/
  cancelled issue-status usages.
- A migration rewrites existing `items.status` (type='issue') per the mapping
  and runs automatically on startup.
- Issues list renders grouped by status with a `review` group between working
  and done.
- `bun run check` green (modulo the pre-existing coverage gate); tests updated.

## Notes

- 2026-05-30 - Investigation + proposal recorded. BKD L3 dispatch is the
  approval; proceeding to implement.
- 2026-05-30 - Implemented. API: `IssueStatus` type + `createIssue` default
  (`issue.service.ts`), both create/update zod enums (`issue.routes.ts`).
  Migration `0003_normalize_issue_status.sql` generated via
  `drizzle-kit generate --custom` (journal + snapshot), data-only UPDATE scoped
  to `type='issue'`; confirmed a fresh `createDb` boot applies all 4 migrations.
  Web: type (`api/projects.ts`, re-used by ships maintenance orders),
  `ISSUE_STATUS_BADGE`, issues-tab enum/tints/dots/glyph/queries/defaults (added
  `review` group + glyph), issue-panel `STATUSES`, ship maintenance
  `STATUS_VARIANTS`, ship active-order sets (`$shipId.lazy.tsx`,
  `-ship-overview-tab.tsx`). i18n en+zh: `projects:issues.status` + `.group`
  rewritten to the five values, standalone `issues.json` status labels aligned.
  Tests/fixtures/seed/e2e updated; added `normalize-issue-status.migration.test.ts`
  (mapping + `type='issue'` scope + no-legacy assertions). Self-review: /pma-cr
  manual pass + repo-wide grep — no leftover `open/in_progress/cancelled` issue
  status outside the migration and its test. Verified: `bun run check` green
  (exit 0; one flaky web-teardown `removeEventListener` error proven transient
  by 2 clean re-runs). Awaiting human verification before BKD move-to-done.
  Minor note (not blocking): `seed.ts` does not populate the new `review`
  status, so the review group is empty in demo data until a row uses it.
