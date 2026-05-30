# FEAT-016 Procurement detail experience with issue-detail parity

- **status**: Completed
- **priority**: P2
- **owner**: l1-lsqiuvv9 / L2 zrk82evn
- **plan**: [PLAN-035](../plan/PLAN-035.md)
- **campaignId**: l1-lsqiuvv9-20260528233234
- **createdAt**: 2026-05-28

## Description

Add a procurement detail surface (drawer + fullscreen/deep-link) that reuses the
project issue detail interaction model and the `/app/zzci/access` portal issue
behavior. Procurement gains description, priority, and dueDate while keeping its
existing fields (itemName, supplier, category, quantity, amount, currency).

## Acceptance criteria

See [PLAN-035](../plan/PLAN-035.md). Summary:

- Procurement rows open into a drawer + fullscreen detail mirroring issues.
- Detail reuses inline title/description, status/priority/dueDate/assignee,
  delete, attachment upload, comments/activity footer, loading/error,
  Escape/close, maximize.
- Backend create/update/detail/list expose description/priority/dueDate with
  issue-comparable validation; migration generated via drizzle-kit (coordinated
  with CHORE-002).
- Existing list behavior, permissions, and project scoping intact.
- Focused tests added; English docs/locales updated; `bun run check` run if
  feasible.

## Subtasks (BKD L3)

- **B** - Backend procurement field parity (schema/service/routes/migration/tests).
- **F** - Frontend procurement detail experience (api hooks + panel + routes +
  tab wiring + create dialog fields + locales + docs + tests). deps=[B].

## Scope Update (2026-05-28, L1)

- Add a `cancelled` procurement status (backend + frontend filters/pipeline/
  detail/locales/tests). Spelling `cancelled` per issue convention.
- Procurement must not be deletable: remove DELETE route + delete UI + delete
  hook end-to-end; tests assert deletion unavailable. Overrides issue-parity
  delete assumption. Pin/comments/attachments/edit stay intact.
- Folded into existing B (backend) and F (frontend) L3s in place; no new L3.

## ActiveForm

Implementing procurement detail parity with issue details.

## Notes

- 2026-05-28 - L2 zrk82evn bootstrap: investigation + proposal recorded;
  decomposed into B -> F DAG.
- 2026-05-28 - B (backend, 7e0xb6a5) merged to main (merge b064260 / feat
  3d42229): description/priority/dueDate (migration 0002), cancelled status,
  non-deletable. 34 procurement tests green, api-docs up-to-date. B in review.
- 2026-05-28 - F (frontend, urtxma4j) dispatched after B merge.
- 2026-05-29 - F first session failed transiently (no work); retried.
- 2026-05-29 - UI parity correction (L1): procurement detail panel used an
  outdated layout (issue panel evolved via sibling REFACTOR-006 after F
  branched). L3 H (029quuip) re-syncs -project-procurement-panel.tsx to the
  current -project-issue-panel.tsx zen layout (drawer+fullscreen, meta-grid
  tiles, footer), keeping procurement fields + non-deletable + cancelled +
  status-endpoint.
- 2026-05-29 - List UI change (L1), folded into L3 G: remove top pipeline
  cards; add a status filter beside the category filter (drives statusFilter,
  includes cancelled); keep create + row-open-drawer.
- 2026-05-29 - G (tab) merged (44da19b): clickable rows, pipeline cards removed, status filter beside category, read-only row status. 16 tests pass.
- 2026-05-29 - List status read-only (L1), folded into L3 G: remove per-row
  status Select; show status as a read-only badge for all rows (incl when
  canManage); status editing only from the detail. Toolbar status filter kept.
- 2026-05-29 - Post-merge UX follow-up (L1): detail was hard to discover -
  only the itemName link opened the drawer, row not clickable. Reopened; L3 G
  (94cmjprh) makes the whole list row open the detail drawer (keyboard + mouse)
  with status-select/pin stopPropagation; routes/panel unchanged.
- 2026-05-29 - F merged to main (merge 0b15157 / feat fc5a57f): procurement
  detail panel + drawer/fullscreen routes + useProcurement hook, cancelled
  status (pipeline/filter/detail/locales), delete UI + hook removed. Verified:
  34 procurement web tests pass (vitest), web typecheck clean, locales
  auto-merged with sibling issue keys intact. Both L3s in review; awaiting human
  verification before `done`. Full `bun run check` not run end-to-end (web
  branch-coverage gate pre-existing-red ~3.99%); targeted gates green.
- 2026-05-29 - H (panel) merged (152db12): re-synced procurement detail panel
  to the CURRENT issue panel layout. Note: the current -project-issue-panel.tsx
  is FLAT access-style (REFACTOR-006), not zen; the procurement panel was the
  only zen surface and diverged from issues. H converted it zen->flat to match
  issues per the user request ("use the new issues version"). 10 panel tests +
  139 projects tests pass, typecheck clean. Both G and H merged; FEAT-016
  Completed (awaiting human verify -> done).
- 2026-05-29 - L1 decision: flat-to-match-issues CONFIRMED. Keep 152db12 (panel
  aligned with the current flat issue-detail layout); do not revert. A future
  zen-everywhere redesign is separate scope. Campaign complete; all 4 L3s in
  review awaiting human move-to-done + worktree cleanup.
