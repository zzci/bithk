# Project Module Audit — Consolidated Summary

Aggregate severity: **P0 0 · P1 7 · P2 20 · P3 39** (66 findings across 7 lanes)

Synthesis of the seven lane audits under [`./project-module/`](./project-module/).
Each lane was a read-only PMA investigate-phase pass over the project module
(backend `apps/api/src/modules/{project,tag}` plus issue/procurement/file/drive
services as consumed by the detail tabs; frontend
`apps/web/src/app/routes/_app/projects/*` plus shared `priority-signal.tsx` /
`status-colors.ts`). No source was modified by any lane. This document only
re-organizes their findings — it introduces no new ones.

---

## 1. Executive summary

The project module is in **good overall health**. Across six quality dimensions
and a dead-code/test sweep there are **zero P0 (critical) defects** — nothing is
actively broken, corrupting data, or bypassing authorization in normal use. The
backend authorization model is the strongest area: cross-project IDOR is
fail-closed everywhere (every tab re-resolves the project from its short id and
re-checks membership + capability on the resource's *real* project), SQL is fully
parameterized, capabilities are sanitized on read and write, and the
`deleteRole` demote-to-Guest path is transactionally correct. Test coverage of the
project module is solid (service, routes, role engine, covers, permission hook,
and most frontend units have dedicated tests), and en/zh locale parity for the
`projects` namespace is complete.

The seven **P1 (high)** findings cluster into two themes. The first and dominant
theme is **performance / query efficiency**: the issue list path is the reference
counter-example to the (correct) procurement path — it runs an N+1 `composeIssue`
(3 queries per row, re-resolving the same project short id N times), does a
two-phase unbounded `inArray` instead of a JOIN, and the issues tab fans this out
**5×** by firing one full list request per status. The project list separately
fetches two extra full pages of fully-composed rows just to display two integer
counts. The second theme is **authorization privilege-escalation latent in the
role model**: `members.manage` can self-assign the system Owner role (full
takeover), `roles.manage` can grant capabilities with no ceiling, and there is no
"last owner" protection — all reachable only by a member an Owner has already
trusted with administration, but each collapses a delegated permission into
effective ownership. The remaining two P1s are a non-atomic contact hard-delete
that can orphan `tags_refs` rows permanently (the one place app-level tag cleanup
runs), and hand-rolled detail drawers with no focus trap / focus restoration (the
most serious accessibility defect, affecting every issue and procurement detail
view).

The **P2/P3 long tail** is dominated by three recurring root causes worth fixing
structurally rather than one-off: (a) the **polymorphic `tags_refs` table with no
`type`/FK** underpins several data-integrity and security nits (orphan-cleanup
fragility, cross-domain isolation by id-convention only); (b) **hand-written
`<button>` elements instead of the shadcn `Button` primitive** recur as missing
focus-visible rings, divergent icon spacing, and inconsistent affordances across
the panels and settings dialog; and (c) **client-side-only list search** on the
project list (filters the current page only) appears in both the correctness and
performance lanes. A handful of stale header/comment drifts (describing UI that
the recent churn removed) and a couple of genuinely dead exports (the tag registry
read-side) round out the cleanups. None of these block release; they are
maintainability and polish debt accumulated by this session's UI churn plus the
tag-abstraction refactor.

---

## 2. Findings by severity (aggregate)

| Severity | Count |
|----------|------:|
| P0 critical | 0 |
| P1 high | 7 |
| P2 medium | 20 |
| P3 low / nit | 39 |
| **Total** | **66** |

Per-lane breakdown (counted from the findings actually listed in each doc):

| Lane | Dimension | P0 | P1 | P2 | P3 | Total |
|------|-----------|---:|---:|---:|---:|------:|
| 01 | Correctness / Bugs | 0 | 0 | 1 | 8 | 9 |
| 02 | Security / AuthZ | 0 | 1 | 2 | 5 | 8 |
| 03 | Performance | 0 | 4 | 4 | 3 | 11 |
| 04 | Data Integrity / Errors | 0 | 1 | 2 | 5 | 8 |
| 05 | UI / UX / Accessibility | 0 | 1 | 7 | 9 | 17 |
| 06 | i18n | 0 | 0 | 2 | 2 | 4 |
| 07 | Tests / Dead Code | 0 | 0 | 2 | 7 | 9 |
| **All** | | **0** | **7** | **20** | **39** | **66** |

> Note: lane docs 02 and 07 carry self-declared header counts that are internally
> off by one or two versus their own enumerated findings (e.g. 02's header says
> P2 3 / P3 6, but it lists 2 / 5; 07's header says P3 8, but lists 7). The table
> above counts the **actually enumerated** findings, which is why it may differ
> from a lane's one-line header. The P1 total of 7 matches the dispatch hint.

---

## 3. Master findings table (severity-sorted)

IDs are namespaced as `LL-Fn` (lane number + the finding's local id) to stay
unique across lanes.

| ID | Severity | Dimension | Title | Location | Lane doc |
|----|----------|-----------|-------|----------|----------|
| 02-F1 | P1 | Security | `members.manage` can self-assign Owner role → full takeover | `project.routes.ts:340-360` | [02](./project-module/02-security-authz.md) |
| 03-F1 | P1 | Performance | Issue list `composeIssue` runs 3 queries per row (N+1) | `issue.service.ts:412-414,94-121` | [03](./project-module/03-performance.md) |
| 03-F2 | P1 | Performance | Issues tab fans out 5 full list requests (one per status) | `-project-issues-tab.tsx:256-260` | [03](./project-module/03-performance.md) |
| 03-F3 | P1 | Performance | Issue `listByProject` two-phase unbounded `inArray` vs a JOIN | `issue.service.ts:381-410` | [03](./project-module/03-performance.md) |
| 03-F4 | P1 | Performance | Project list fetches two extra full pages just for status counts | `index.lazy.tsx:50-51`; `project.service.ts:347-394` | [03](./project-module/03-performance.md) |
| 04-F1 | P1 | Data Integrity | Contact hard-delete cleans `tags_refs` outside any transaction (non-atomic) | `contact.service.ts:218-233` | [04](./project-module/04-data-integrity-errors.md) |
| 05-F1 | P1 | A11y | Detail drawers are hand-rolled modals: no focus trap / restoration | `$projectId.issues.$issueId.lazy.tsx:96-137`; `$projectId.procurements.$procurementId.lazy.tsx:96-139` | [05](./project-module/05-ui-ux-accessibility.md) |
| 01-F1 | P2 | Correctness | Projects list search only filters the current page (client-side) | `index.lazy.tsx:62-72,49` | [01](./project-module/01-correctness-bugs.md) |
| 02-F2 | P2 | Security | `roles.manage` allows unbounded capability escalation on custom roles | `project.roles.ts:158-200` | [02](./project-module/02-security-authz.md) |
| 02-F3 | P2 | Security | No safeguard against demoting/removing the last Owner (lockout) | `project.service.ts:604-636` | [02](./project-module/02-security-authz.md) |
| 03-F5 | P2 | Performance | `searchIssues` is N+1 with no batching at all | `issue.service.ts:458-462` | [03](./project-module/03-performance.md) |
| 03-F6 | P2 | Performance | No standalone index on `project_members.user_id` | `project/schema.ts:89-95` | [03](./project-module/03-performance.md) |
| 03-F7 | P2 | Performance | `loadResourceTagsByResource` correlated COUNT subquery per (row,tag) | `tag.service.ts:235-245` | [03](./project-module/03-performance.md) |
| 03-F8 | P2 | Performance | Overview + tab bar issue redundant count vs latest queries | `$projectId.lazy.tsx:54-55`; `-project-overview-tab.tsx:40-41` | [03](./project-module/03-performance.md) |
| 04-F2 | P2 | Data Integrity | Project soft-delete does not cascade; child rows stay live forever | `project.service.ts:429-438` | [04](./project-module/04-data-integrity-errors.md) |
| 04-F3 | P2 | Data Integrity | Latent: project/item hard-delete cascade bypasses `tags_refs` cleanup | `project/schema.ts:48`; `item/schema.ts:20` | [04](./project-module/04-data-integrity-errors.md) |
| 05-F2 | P2 | A11y | Issue drawer `role="dialog"` has no accessible name | `$projectId.issues.$issueId.lazy.tsx:102-107` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F3 | P2 | A11y | Inline title editing is mouse-only (no keyboard affordance) | `-project-issue-panel.tsx:306-313`; `-project-procurement-panel.tsx:314-321` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F4 | P2 | A11y | Due-date picker calls `showPicker()` with no fallback | `-project-issue-panel.tsx:445-464`; `-project-procurement-panel.tsx:442-462` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F5 | P2 | A11y | Hand-written inline buttons lack a focus-visible indicator | `-project-issue-panel.tsx:472-555`; `-project-procurement-panel.tsx:469-780`; `-project-settings-dialog.tsx:98-114` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F6 | P2 | A11y | Settings dialog tablist has incomplete ARIA + no arrow-key nav | `-project-settings-dialog.tsx:93-160` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F7 | P2 | A11y | Assignee avatar palette fails text contrast (fixed -500 + white) | `-project-issues-tab.tsx:90-102,166` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F8 | P2 | A11y | Project card nests an interactive button inside `role="button"` | `index.lazy.tsx:237-273` | [05](./project-module/05-ui-ux-accessibility.md) |
| 06-F1 | P2 | i18n | `zh/drive.json` has 7 untranslated (English) values | `locales/zh/drive.json:30,99,203-207` | [06](./project-module/06-i18n.md) |
| 06-F4 | P2 | i18n | No automated en/zh key-parity / untranslated-value guard | `apps/web/src/app/i18n.ts` | [06](./project-module/06-i18n.md) |
| 07-F1 | P2 | Dead Code | Tag registry read-side is dead code; module comment misleading | `tag.registry.ts:20,28,4-7` | [07](./project-module/07-tests-deadcode.md) |
| 07-F2 | P2 | Tests | `projectBackupContribution` has no test (backup round-trip gap) | `project.backup.ts:4`; `project/index.ts:7` | [07](./project-module/07-tests-deadcode.md) |
| 01-F2 | P3 | Dead Code | `StatCard` / `StatStrip` are dead code (defined, never rendered) | `-project-stats.tsx:1-69` | [01](./project-module/01-correctness-bugs.md) |
| 01-F3 | P3 | Correctness | `StatCard` active state renders no ring (color without width) | `-project-stats.tsx:42` | [01](./project-module/01-correctness-bugs.md) |
| 01-F4 | P3 | UX | Procurement status palette collapses two lifecycle states to one color | `status-colors.ts:28-36` | [01](./project-module/01-correctness-bugs.md) |
| 01-F5 | P3 | UX | `todo` status renders two different colors within the issues tab | `-project-issues-tab.tsx:63-78`; `status-colors.ts:18` | [01](./project-module/01-correctness-bugs.md) |
| 01-F6 | P3 | Maintainability | Stale header/inline comments describe removed UI | `-project-issues-tab.tsx:1-10,71-72` | [01](./project-module/01-correctness-bugs.md) |
| 01-F7 | P3 | Correctness | A single status query failure blanks the entire issues list | `-project-issues-tab.tsx:276,349-350` | [01](./project-module/01-correctness-bugs.md) |
| 01-F8 | P3 | Correctness | Procurement category filter goes stale when selected category deleted | `-project-procurement-tab.tsx:166-174,302-303` | [01](./project-module/01-correctness-bugs.md) |
| 01-F9 | P3 | UX | Inline-tag cap can force a "More" trigger even when every chip fits | `-project-tag-filter.tsx:125-128` | [01](./project-module/01-correctness-bugs.md) |
| 02-F4 | P3 | Security | Member create/update accept arbitrary `userId` → 500 not 4xx | `project.routes.ts:79-97`; `project.service.ts:577-629` | [02](./project-module/02-security-authz.md) |
| 02-F5 | P3 | Security | Global tag vocabulary + cross-project usage counts exposed to any user | `tag.routes.ts:22-26`; `tag.service.ts:58-71` | [02](./project-module/02-security-authz.md) |
| 02-F6 | P3 | Security | `tags_refs` join has no type/domain scoping (isolation by id-space) | `tag.service.ts:192-252` | [02](./project-module/02-security-authz.md) |
| 02-F7 | P3 | Security | Comment routes don't validate subject belongs to path `:projectId` | `comment.routes.ts:99-115` | [02](./project-module/02-security-authz.md) |
| 02-F8 | P3 | Security | No rate limiting on project-module mutation endpoints | `project.routes.ts:169-171` | [02](./project-module/02-security-authz.md) |
| 03-F9 | P3 | Performance | `backfillProjectRoles` is a per-project query loop at boot | `project.roles.ts:255-266` | [03](./project-module/03-performance.md) |
| 03-F10 | P3 | Performance | Project list search filters only current page; server `q` unused | `index.lazy.tsx:62-72` | [03](./project-module/03-performance.md) |
| 03-F11 | P3 | Performance | Large tabs not memoized; inline callbacks recreate each render | `-project-issues-tab.tsx`; `-project-procurement-tab.tsx` | [03](./project-module/03-performance.md) |
| 04-F4 | P3 | Data Integrity | Cover-image reference release not atomic with project update | `project.service.ts:466-500,534-566` | [04](./project-module/04-data-integrity-errors.md) |
| 04-F5 | P3 | Data Integrity | Project update bumps `version` but enforces no optimistic-concurrency check | `project.service.ts:403-422` | [04](./project-module/04-data-integrity-errors.md) |
| 04-F6 | P3 | Data Integrity | `deleteRole` "guest missing" fallback would FK-fail, not degrade | `project.roles.ts:209-228` | [04](./project-module/04-data-integrity-errors.md) |
| 04-F7 | P3 | Data Integrity | `createProject` default-cover existence check is TOCTOU vs insert FK | `project.service.ts:281-307` | [04](./project-module/04-data-integrity-errors.md) |
| 04-F8 | P3 | Data Integrity | `tags_refs` is polymorphic with no `type` column (id-disjointness) | `tag/schema.ts:19-31` | [04](./project-module/04-data-integrity-errors.md) |
| 05-F9 | P3 | UX | `todo` status reads as two different colors (dot vs list icon) | `-project-issues-tab.tsx:63-78` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F10 | P3 | UX | Procurement "New" button icon diverges from the issues tab | `-project-procurement-tab.tsx:192` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F11 | P3 | UX | Procurement list rows visually diverge from issues rows | `-project-procurement-tab.tsx:237` vs `-project-issues-tab.tsx:395` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F12 | P3 | UX | "Filter by tag" label sits over the status filter buttons | `index.lazy.tsx:108-138` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F13 | P3 | Maintainability | Stale header comment describes a removed status-filter chip row | `-project-issues-tab.tsx:1-10` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F14 | P3 | UX | Overview "View all" uses `size="sm"` against the button standard | `-project-overview-tab.tsx:249` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F15 | P3 | A11y | Drawer resize handle has no keyboard support | `$projectId.issues.$issueId.lazy.tsx:111-119`; procurements `:112-120` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F16 | P3 | UX | Read-only "no description" placeholder mimics the editable button | `-project-issue-panel.tsx:556-560`; `-project-procurement-panel.tsx:658-662` | [05](./project-module/05-ui-ux-accessibility.md) |
| 05-F17 | P3 | Maintainability | Prefer shadcn `Button` over hand-written `<button>` (guideline) | `-project-issue-panel.tsx:472,483,548`; `-project-procurement-panel.tsx:469,480,650,769`; `-project-settings-dialog.tsx:98` | [05](./project-module/05-ui-ux-accessibility.md) |
| 06-F2 | P3 | i18n | English plural forms not handled for `{{count}}` interpolations | `locales/en/projects.json:37,165,221,207-208`; `drive.json:48` | [06](./project-module/06-i18n.md) |
| 06-F3 | P3 | i18n | `projects` ns duplicates `issues.status` / `issues.group` verbatim | `locales/en/projects.json:184-197` | [06](./project-module/06-i18n.md) |
| 07-F3 | P3 | Tests | Project detail tab-nav shell (`$projectId.lazy.tsx`) untested | `$projectId.lazy.tsx:37-190` | [07](./project-module/07-tests-deadcode.md) |
| 07-F4 | P3 | Tests | Per-issue React-Query hooks (`-project-issue-hooks.ts`) untested | `-project-issue-hooks.ts:27-75` | [07](./project-module/07-tests-deadcode.md) |
| 07-F5 | P3 | Tests | `tag.registry.ts` has no test | `tag.registry.ts` | [07](./project-module/07-tests-deadcode.md) |
| 07-F6 | P3 | Dead Code | `assertValidTagName` over-exported | `tag.service.ts:30` | [07](./project-module/07-tests-deadcode.md) |
| 07-F7 | P3 | Maintainability | Duplicated `TabsTrigger` className repeated verbatim ×4 | `$projectId.lazy.tsx:150,154,160,166` | [07](./project-module/07-tests-deadcode.md) |
| 07-F8 | P3 | Tests | `-project-cover-field.tsx` and `-project-stats.tsx` untested | `-project-cover-field.tsx`; `-project-stats.tsx:19-54` | [07](./project-module/07-tests-deadcode.md) |
| 07-F9 | P3 | Tests | Two narrow branch gaps: category PATCH-404 and cover-hook admin bypass | `project.routes.ts:422-430`; `project.cover.permission.ts:16,22` | [07](./project-module/07-tests-deadcode.md) |

---

## 4. Recommended remediation order

Findings group into a small number of fix-campaigns. Dispatch order is by
risk-reduction-per-effort, not strictly by severity — the security-model and
data-integrity work is highest-leverage because each defect collapses a trust or
correctness boundary, while the performance work is the largest user-visible win.

### Campaign A — Project role / authz hardening (do first)
P1 02-F1, P2 02-F2, P2 02-F3, plus P3 02-F4.
All four are the same surface: the role/member model lets delegated admin
permissions amplify into full ownership and lacks a last-owner invariant. Fix
together — reject Owner/system-role assignment in `addMember`/`updateMember`,
constrain `roles.manage` so a caller cannot grant capabilities it does not hold
(or restrict the dangerous caps to Owner/app-admin), add a "≥1 owner must remain"
guard, and validate `userId` existence/uniqueness to return clean 4xx. Small,
self-contained backend change with the highest security payoff.

### Campaign B — Issue-list / project-list performance (largest UX win)
P1 03-F1, 03-F2, 03-F3, 03-F4, plus P2 03-F5, 03-F7, 03-F8 and supporting P2 03-F6.
The procurement list (`procurement.service.ts:410-468`) is the proven reference
pattern; port it to the issue path: `innerJoin items ⋈ issueDetails`, resolve the
project short id once per page, batch assignee tuples and tags, drop the embedded
per-row `usageCount` subquery. Collapse the issues tab's 5-request status fan-out
into one request grouped client-side, and switch the project-list count queries to
`limit:1` (or a counts endpoint). Add the `project_members.user_id` index in the
same migration. These compound, so do them as one campaign.

### Campaign C — Data-integrity / transaction correctness
P1 04-F1, P2 04-F2, P2 04-F3, plus P3 04-F4, 04-F6, 04-F7.
Wrap the contact hard-delete cleanup (row + `tags_refs` + tuples + shares) in one
transaction (04-F1, highest); decide and document project soft-delete cascade
semantics (04-F2); make the `creator_id` cascade contract explicit before any user
hard-delete exists (04-F3, latent but a footgun). Fold in the cover-reference
atomicity, the misleading `deleteRole` fallback comment, and the default-cover
TOCTOU as cheap correctness/clarity fixes.

### Campaign D — Detail-drawer accessibility (focused a11y fix)
P1 05-F1, P2 05-F2, plus P3 05-F15.
Re-implement the issue/procurement detail drawers on the existing
`Sheet`/`SheetContent` primitive (focus trap, restoration, `inert`, Escape,
scroll-lock for free), which resolves the most serious a11y defect and its sibling
naming/resize nits in one move.

### Campaign E — Project-module a11y / button-standard sweep
P2 05-F3, 05-F4, 05-F5, 05-F6, 05-F7, 05-F8, plus P3 05-F9..F17, 07-F7, 01-F3.
Largely a "port hand-written `<button>`s to shadcn `Button`" + ARIA cleanup pass:
keyboard-reachable inline title editing, guarded `showPicker`, focus-visible rings,
proper tablist ARIA/roving-tabindex, avatar contrast, un-nesting the card button,
plus the cosmetic color/spacing/divergence nits. Tackle after D since both touch
the panels.

### Campaign F — List search correctness + UX polish
P2 01-F1 / P3 03-F10 (same defect, two lanes), plus P3 01-F4, 01-F5/05-F9 (same),
01-F7, 01-F8, 01-F9.
Push project-list search to the server `q` param (the backend already supports
it) so results aren't page-local; then the status-color collapse, the `todo`
color inconsistency (one finding seen by two lanes), the fail-closed issues-list
blanking, the stale category filter, and the tag-cap overflow.

### Campaign G — i18n parity + CI guard
P2 06-F1, 06-F4, plus P3 06-F2, 06-F3.
Translate the 7 English `zh/drive.json` values, then add the Vitest parity spec
(key-set diff + ASCII-identical-value warning) to `bun run check` so F1-class
regressions are caught automatically; add English plural forms and de-duplicate
the status/group blocks as low-priority cleanup.

### Campaign H — Dead code + test gaps (lowest urgency)
P2 07-F1 (resolve the tag-registry half-built pattern: delete the dead read-side
or wire `/tags` to it), P2 07-F2 (project backup round-trip test), plus the
remaining P3 test gaps (07-F3, F4, F5, F8, F9), 07-F6 over-export, and 01-F2/01-F6
dead-code/stale-comment cleanups. Coordinate 07-F1/07-F5 (registry) and 01-F2
(`-project-stats.tsx` dead code, which also subsumes 01-F3 and part of 07-F8).

Cross-cutting note: the **polymorphic `tags_refs`** issue (02-F6 / 04-F8 — same
root cause across two lanes) and the **`todo` two-color** issue (01-F5 / 05-F9)
and the **list-search** issue (01-F1 / 03-F10) are each reported by two lanes;
fix once per the campaigns above to avoid double-counting effort.
