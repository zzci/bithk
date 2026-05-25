# PLAN-019 Prototype parity remediation for UI-001

- **status**: completed
- **createdAt**: 2026-05-25 17:10
- **approvedAt**: 2026-05-25 17:10
- **relatedTask**: UI-004

## Context

UI-001 was merged to `main`, but human browser verification failed. The online
reference prototype is `https://fr.ds.cc/bit.html`; it matches the local
handoff bundle under `backup/untitled/project/`.

Observed blockers:

- `/projects` crashes in a browser with `Invalid language tag: en-US@posix`.
- The local dev database currently has empty ships and contacts, making visual
  review collapse to empty states.
- The implemented content pages are not a close match to the prototype. Missing
  or reduced items include ship import/global-template/type controls, ship card
  illustrations and metrics, project import/grid-list controls and dense
  metrics, and contacts type/import/export/rating/reference columns.

## Proposal

Resume the existing BKD L2 issue `cw6d4wrk` and have it create new L3
remediation subtasks under campaign `l1-mwo9qmid-20260525155159`.

Recommended L3 decomposition:

1. Runtime and browser-smoke foundation.
   - Fix locale tag normalization so `/projects` renders in real Chromium.
   - Add a real-browser smoke check for `/ships`, `/projects`, and `/contacts`.
   - Verify with `bun run check` plus the browser smoke.
2. Prototype parity and fixture audit.
   - Compare `https://fr.ds.cc/bit.html` against current implementation.
   - Decide how L3 visual work should be verified with representative data.
   - Document impossible items that require backend/schema/domain support.
3. Ships content-page parity.
   - Restore in-scope prototype controls, card density, metrics, and detail-tab
     presentation where supported by current APIs.
   - Keep permissions, routes, and FileBrowser anchoring unchanged.
4. Projects content-page parity.
   - Restore list/detail density and controls; fix any counts that can be
     backed by current APIs without cache-key collisions.
   - Keep issue drawer routes, procurement permissions, and settings gates.
5. Contacts content-page parity.
   - Restore directory density, type-style filtering where current data allows,
     and table columns supported by current contact fields.
   - Preserve confidential contact masking and share/edit/delete permissions.
6. Integration pass.
   - Merge green work in dependency order.
   - Run `bun run check`, real-browser smoke, and screenshot comparison against
     the online prototype.

## Scope

In scope:

- `apps/web/src/app/routes/_app/ships/**`
- `apps/web/src/app/routes/_app/projects/**`
- `apps/web/src/app/routes/_app/contacts/**`
- Local test/smoke support needed to verify those pages
- Locale normalization if required to unblock the projects page

Out of scope unless L2 escalates and human approves:

- Global sidebar or app shell rewrite
- Backend schema changes
- Shared FileBrowser behavior changes
- Replacing the production app with static prototype code

## Risks

- Some prototype metrics and actions may be presentation-only and not backed by
  current APIs. These need explicit L2 escalation rather than fabricated data.
- Real-browser checks may require stable auth/session setup in dev.
- Visual parity against a static demo can conflict with production permission
  and masking rules; production security behavior wins.

## Annotations

- 2026-05-25 17:10 - Approved by user direction to resume L1 coordination and
  have L2 decompose L3 remediation fixes.
- 2026-05-25 17:20 - L1 decision on Stage B escalations: keep UI-004 scoped to
  frontend-only parity for current APIs; backend/schema/API prototype gaps
  should become a separate effort after UI-004. Approved the small shared
  procurement query-key fix because it directly enables real frontend-backed
  procurement counts and is low risk.
- 2026-05-25 18:30 - Remediation completed. Merged stages:
  A `f4c61b2`, B `9068bb6`, E `b9903bc`, C `db91f84`, D `49ca53f`, and
  F `0f2c359`. Final `bun run check` and `bun run smoke` passed; closeout and
  screenshot comparison are in `docs/plan/PLAN-019-parity-closeout.md` and
  `docs/plan/parity-shots/PLAN-019-F/`.
