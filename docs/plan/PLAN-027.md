# PLAN-027 Original issue detail behavior migration

- **status**: completed
- **createdAt**: 2026-05-28 16:32
- **approvedAt**: 2026-05-28 16:32
- **relatedTask**: FIX-006

## Context

Current BITHK implementation:

- Backend:
  - `apps/api/src/modules/issue/schema.ts`
  - `apps/api/src/modules/issue/issue.service.ts`
  - `apps/api/src/modules/issue/issue.routes.ts`
  - `apps/api/src/modules/item/comment.routes.ts`
  - `apps/api/src/modules/issue/issue.routes.test.ts`
  - `apps/api/src/modules/issue/issue.test.ts`
  - `tests/e2e/modules/issue/*`
- Frontend consumers, read only unless a non-visible test/contract update is
  strictly required:
  - `apps/web/src/shared/lib/api/projects.ts`
  - `apps/web/src/app/routes/_app/projects/-project-issue-hooks.ts`
  - `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx`
  - `apps/web/src/app/routes/_app/projects/$projectId.issues.$issueId.lazy.tsx`
  - `apps/web/src/app/routes/_app/projects/$projectId_.issues.$issueId.full.lazy.tsx`

Reference/original implementation in `/app/zzci/access`:

- Backend:
  - `/app/zzci/access/apps/api/src/modules/issue/schema.ts`
  - `/app/zzci/access/apps/api/src/modules/issue/issue.service.ts`
  - `/app/zzci/access/apps/api/src/modules/issue/issue.routes.ts`
  - `/app/zzci/access/apps/api/src/modules/item/comment.routes.ts`
  - `/app/zzci/access/tests/e2e/modules/issue/*`
- Frontend detail behavior:
  - `/app/zzci/access/apps/web/src/app/routes/_app/portal/issues/-issue-panel.tsx`
  - `/app/zzci/access/apps/web/src/app/routes/_app/portal/issues/index.lazy.tsx`
  - `/app/zzci/access/apps/web/src/app/routes/_app/portal/issues/$issueId.lazy.tsx`

Initial comparison:

- Original issue details were global `/issues/:id` resources. Detail access was
  limited to admin, creator, or assignee. Creator/admin could edit all fields;
  assignee could update status only. The detail UI fetched its own issue and
  visible-user list, supported inline title/description/status/priority/
  assignee/due-date editing, attachments, comments, drawer open, and fullscreen
  navigation.
- Current BITHK work orders are project-scoped
  `/projects/:projectId/issues/:id` resources. Detail access is gated by project
  membership or app admin and fail-closes wrong project/non-member access as
  404. Creator or `issue.manage` member can edit all fields; member assignee
  can update status only. Assignee identity is now `project_members.id`, with an
  internal user tuple mirrored for account-backed members and no tuple for
  external members.
- Current detail panel still supports inline title/description/status/priority/
  assignee/due-date editing, attachments, comments, drawer open, and fullscreen
  navigation through project-scoped endpoints. The current frontend receives
  members and visible users from the project route wrappers rather than fetching
  them inside the panel.
- Current backend already exposes project-scoped comments, comment attachments,
  issue attachments, attachment download/preview, soft delete, audit events, and
  pin/unpin. The shared resource footer builds correct URLs for project-scoped
  resource prefixes such as `projects/:projectId/issues`.

Missing or risky detail capability candidates:

- No obvious visible detail capability from the original implementation is
  missing after the project-scoped migration.
- The non-UI parity risk is test coverage: existing route tests cover detail
  read/update/delete membership rules, and e2e covers admin CRUD/comments/
  attachments, but focused route coverage should explicitly lock the original
  detail behavior after project scoping:
  - creator/member-manager can edit all detail fields;
  - account-backed member assignee can update status but not other fields;
  - project member who is neither creator nor assignee cannot edit;
  - detail comments/attachments remain available through the project-scoped
    resource path.
- A visible frontend UI change is not required for the currently identified
  parity work.

## Proposal

Dispatch one focused L3 implementation task in a worktree.

1. Re-check the current/reference comparison and confirm whether any backend or
   contract behavior is actually missing.
2. If a non-UI behavior gap exists, implement only the smallest backend/API/
   service/model/test change needed to restore it.
3. If no backend behavior gap exists, add or tighten focused tests that lock the
   project-scoped detail parity described above without changing visible UI.
4. Do not edit frontend UI components, styles, locale strings, or interaction
   patterns.
5. Run focused backend tests for the issue module and attempt `bun run check`.

## Risks

- The current repository has active unrelated campaigns with uncommitted
  frontend/PMA changes. The implementation task must avoid those files unless a
  non-visible test/contract update is strictly required.
- Original global issue assignment used users; current project work orders use
  project members. Reverting that would conflict with the current project model
  and is out of scope.
- If a later finding requires visible UI changes, this plan must escalate to L1
  before editing UI.

## Scope

In scope:

- `apps/api/src/modules/issue/*`
- `apps/api/src/modules/item/comment.routes.ts` only if route behavior needs a
  targeted fix.
- Focused API/e2e tests under `apps/api/src/modules/issue/*` or
  `tests/e2e/modules/issue/*`.
- PMA task/plan/changelog tracking.

Out of scope:

- Visible frontend UI files and locale copy.
- Work-order list/card/dialog redesign.
- Database schema changes unless an actual reference parity gap requires them.
- Dependency upgrades and unrelated module refactors.

## Verification Plan

- Run focused issue module tests.
- Run focused e2e module tests if the test harness is available.
- Attempt `bun run check`.
- Report unrelated failures without fixing unrelated active-campaign work.

## Alternatives

- Reintroduce global `/issues/:id` detail routes. Rejected because BITHK has
  deliberately migrated issues into the project module and removed global
  issues.
- Move visible-user/member fetching back into the panel. Rejected because it
  would touch frontend component behavior and current route wrappers already
  provide the data without changing the UI.
- Make no code/test changes. Acceptable only if L3 confirms focused coverage
  already locks the parity behavior.

## Annotations

- 2026-05-28 16:32 - Investigation and proposal recorded. Automatic execution
  is active for non-UI backend/API/data/test work, so this plan is approved for
  a focused L3 dispatch.
- 2026-05-28 16:35 - L1 policy update applied for this and future wakes: L2
  must not write implementation code directly. Product/source implementation
  belongs to focused L3 subtasks using the safe BKD flow with
  `engineType=claude-code`. L2 remains responsible for investigation, PMA
  tracking, DAG planning, dispatch, clarification, quality assessment,
  integration/merge decisions, verification coordination, and L1 reporting.
- 2026-05-28 16:50 - L3 `nnkhy9ja` completed the focused non-UI parity task.
  The comparison found current project-scoped issue detail behavior is a
  superset of the original global issue detail behavior, with no backend/API/
  service/model gap. Merged commit `15af409` via `23b342a`; the change is
  test-only and does not touch frontend UI.
- 2026-05-28 16:50 - Verification passed: focused issue route tests
  (`bun test apps/api/src/modules/issue/issue.routes.test.ts`) and full
  `bun run check`.
