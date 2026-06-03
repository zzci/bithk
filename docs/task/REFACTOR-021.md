# REFACTOR-021 — Project member/assignee pickers → unified users (drop displayName)

- Status: Planned
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
