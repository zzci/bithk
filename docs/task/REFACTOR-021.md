# REFACTOR-021 — Project member/assignee pickers → unified users (drop displayName)

- Status: Completed (merged into bkd/fto2m2se)
- Plan: [PLAN-066](../plan/PLAN-066.md)
- Campaign: l1-75ymcfnr-vuser-20260603200111
- Owner: L2 fto2m2se dispatch → L3-3
- Created: 2026-06-03

## Summary

Switch project member add + member/assignee display to the unified users model:

- `ProjectMemberView` type: DROP `displayName`; ADD `name: string` +
  `isVirtual: boolean` (resolved server-side by L3-1's `composeMember`).
- `AddProjectMemberInput`: `userId` REQUIRED; drop `displayName`.
  `UpdateProjectMemberInput`: drop `displayName` + the promote-by-userId path
  (members are always real rows now; conversion is an admin op).
- `-project-settings-members.tsx`: AddMemberDialog loses the real/virtual kind
  selector + the free-text displayName Input — it is just a user picker
  (real+virtual from the new `assignable-users` endpoint) + role + title.
  EditMemberDialog loses displayName + promote. Member table shows
  `member.name` + virtual badge from `member.isVirtual`.
- `-member-helpers.ts`: `memberLabel` resolves from `member.name`
  (displayName removed).
- Member-add candidate list: new `useAssignableUsers` hook → `GET
  /account/assignable-users` (real+virtual). Keep `useVisibleUsers` for the
  other consumers (creator name, comment authors) — sharing stays real-only.
- Tests: `-project-settings-members.test.tsx`, `-member-helpers.test.ts`, and
  the issue/procurement panel + tab tests that build member labels from
  `displayName`/`userNames`.
- i18n en+zh parity (remove now-unused virtual-member-kind / displayName keys
  if any; add any needed picker strings).

## Files in scope

- `apps/web/src/app/routes/_app/projects/-project-settings-members.tsx` (+ test)
- `apps/web/src/app/routes/_app/projects/-member-helpers.ts` (+ test)
- `apps/web/src/shared/lib/api/projects.ts`
- Project issue/procurement panel + tab files that resolve member/assignee
  labels (e.g. `-project-issue-panel.tsx`, `-project-procurement-panel.tsx`,
  `-project-issues-tab.tsx`, `-project-procurement-tab.tsx`) + their tests, and
  the `$projectId*.lazy.tsx` wrappers that pass `members`/`userNames`.
- `apps/web/src/locales/{en,zh}/projects.json`

## Dependencies

- L3-1 (REFACTOR-020) backend: member view `name`+`isVirtual`, `userId`-only
  member API, `GET /account/assignable-users`.

## Status notes

- 2026-06-03: Created (planned, deps=L3-1). File-disjoint from L3-2.
- 2026-06-03: **L3-3 (r0qlbvyo) MERGED** into bkd/fto2m2se via cherry-pick of its
  own commit 8d4f820 → a24075f. ProjectMemberView drops displayName + adds
  name/isVirtual; AddProjectMemberInput userId required; new useAssignableUsers;
  AddMemberDialog = single unified user picker (real+virtual) excluding existing
  members, kind selector + displayName input removed; EditMemberDialog role+title
  only; member table virtual badge driven by member.isVirtual; memberLabel →
  member.name; dead i18n keys removed (members.kind.*, field.kind,
  field.displayName, promote). **OVERLAP RECONCILIATION:** L3-3 was based on the
  newer main that includes the foreign `roledup` campaign (PLAN-063: systemRoleLabel
  + Guest excluded from assignable roles, in -member-helpers.ts +
  -project-settings-members.tsx). The cherry-pick onto our pre-roledup base
  auto-merged those two source files in a way that DROPPED roledup's
  systemRoleLabel (→ 2 roledup tests failed). Resolved by `git checkout
  bkd/r0qlbvyo --` the overlapping member files so they exactly match L3-3's
  tested state (roledup systemRoleLabel/Guest-exclusion + our picker changes),
  amended into a24075f. `roles.guest` i18n + `ProjectRoleView.kind` already
  existed in our base, so it compiles + check:i18n passes. Recheck `bun run check`:
  web 670/670 + api 1450/0, build/i18n/env/api-docs green; EXIT 1 ONLY from the
  known @milkdown/ctx teardown flake (removeEventListener, -project-issue-panel.test.tsx;
  0 real failures). Completed.
- NOTE for L1 final merge: bkd/fto2m2se is intentionally scoped to ONLY this
  campaign (cherry-picks, pre-roledup base) EXCEPT the member files which now
  match roledup+picker (superset of main's roledup version → easier 3-way). main
  currently has roledup/ovratio/roleui (PLAN-063/064/065); our plan was renumbered
  PLAN-063 → **PLAN-066** to avoid the file-level collision.
