# FEAT-018 — Project work orders reference ship worklists

- Status: Completed (on bkd/52r11h7b; awaits L1 review + merge to main)
- Plan: [PLAN-057](../plan/PLAN-057.md)
- Campaign: l1-75ymcfnr-wlref-20260603153351
- Owner: L2 52r11h7b dispatch
- Created: 2026-06-03

## Summary

Let a ship base project (`projects.shipId` set) reference one of its ship's
worklists (or a global worklist) when creating a work order (issue): the picker
pre-fills the issue title (worklist name) and description (rendered checklist +
precautions) and the created issue records the referenced worklist id via the
existing `issue_references` mechanism (refType `worklist`). No new column / no
migration — see PLAN-057 "Key design decision".

## Lanes (L3)

- **L3-1 backend** — expose `shipId` on `ProjectView`/project detail; add
  `GET /projects/:projectId/referenceable-worklists` (`{ ship, global }`) +
  `listReferenceableWorklists` helper; targeted tests.
- **L3-2 frontend** (deps: L3-1) — "清单" picker button in the create-issue
  dialog (ship-base-project only), searchable picker grouped 本船/全局, populate
  title+description, removable "引用清单" chip, pass `references` on create,
  surface the reference in the issue detail panel; i18n en+zh; tests.

## Status notes

- 2026-06-03: Investigation + plan (PLAN-057). Discovered the issue→worklist
  reference infra (table/service/routes/create-path + web client type) already
  exists; backend work reduced to `shipId` exposure + a referenceable-worklists
  endpoint. L3-1 dispatched; L3-2 created (planned, deps=L3-1).
- 2026-06-03: **L3-1 (h1rn6c3s) MERGED** into bkd/52r11h7b (--no-ff, merge
  e1411fc; L3 commit 75f4766). Adds `ProjectView.shipId` and
  `GET /projects/:projectId/referenceable-worklists` (`{ship,global}`,
  issue.view-gated); no migration. Post-merge `bun run check` EXIT 0 (api 1437,
  web 659, build/i18n/env/api-docs green). L3-2 (njrg8zcq) dispatched (working).
- 2026-06-03: **L3-2 (njrg8zcq) MERGED** into bkd/52r11h7b (--no-ff, merge
  2783cc1; L3 commit 5535b07). Adds the "清单" picker pill (ship-base-project
  only) + searchable 本船/全局 picker (`-worklist-picker.tsx`) + title/description
  populate + removable "引用清单" chip + `references` on create + referenced-
  worklist display in the issue detail panel + `useReferenceableWorklists` /
  `useIssueReferences` hooks + en/zh i18n + tests. Web `ProjectView.shipId` made
  OPTIONAL to avoid touching ~8 out-of-scope ProjectView test fixtures (runtime
  always supplies it). Post-merge `bun run check` EXIT 0. **Both lanes merged;
  campaign implementation COMPLETE on bkd/52r11h7b — awaits L1 review + merge to
  main.** Note: L3-2 was initially cut from a stale base and self-corrected via
  `git reset --hard bkd/52r11h7b` + one clean commit (BKD stale-base pattern).
