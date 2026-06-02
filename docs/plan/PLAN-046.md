# PLAN-046 Priority default low + unify status icon

- **status**: Completed
- **owner**: l1-75ymcfnr / L2 ltkgr2rj
- **campaignId**: l1-75ymcfnr-pridef-20260602013633
- **tasks**: [FIX-018](../task/FIX-018.md), [FIX-019](../task/FIX-019.md)
- **createdAt**: 2026-06-02

## Goal

Two related project-issue surface changes, both touching
`-project-issues-tab.tsx`, so implemented in ONE combined L3 worktree to avoid
an intra-file merge conflict:

1. **Priority default = low, no `none` level.** Priority stays the 4-level union
   `low|medium|high|urgent`; `low` is BOTH the default and the lowest. Flip the
   create defaults from `medium` to `low` (frontend create dialogs + backend
   schema/service defaults), and REMOVE the display-only `none`/dash fallback a
   prior campaign (FIX-016) added to `priority-signal.tsx`, so it is 4-level
   only again.
2. **One global status icon.** The create-issue dialog status selector currently
   uses a separate colored `STATUS_DOT` helper, while the list uses `StatusIcon`
   (distinct glyph per status). Delete `STATUS_DOT` and reuse `StatusIcon` in
   the selector trigger + dropdown items, so there is exactly ONE status-icon
   representation app-wide.

## Investigation

### Priority default sources

- Frontend create dialog (issues): `-project-issues-tab.tsx:528`
  `useState<IssuePriority>("medium")` and reset `:560 setPriority("medium")`.
- Frontend create form (procurement): `-project-procurement-tab.tsx:380`
  `useState<ProcurementPriority>("medium")` and reset `:396`.
- Backend issue: `apps/api/src/modules/issue/schema.ts:31`
  `.default("medium")`; `issue.service.ts:134` (`details.priority ?? "medium"`)
  and `:223` (`input.priority ?? "medium"`).
- Backend procurement: `apps/api/src/modules/procurement/schema.ts:41`
  `.default("medium")`; `procurement.service.ts:213` (`input.priority ?? "medium"`).
- Tests asserting the medium default that must flip to low:
  `apps/api/src/modules/issue/issue.test.ts:115` (DDL `DEFAULT 'medium'`), `:208`;
  `apps/api/src/modules/procurement/procurement.routes.test.ts:217` ("defaults
  priority to medium") + its assertion ~`:226`+.

### Priority `none` fallback (to remove)

`apps/web/src/shared/components/priority-signal.tsx` — FIX-016 added a
display-only `PriorityDisplay = Priority | "none"` type, a `none` entry in
`PRIORITY_META` (`Minus` icon), and a `?? PRIORITY_META.none` runtime fallback.
Remove all of it: drop the `Minus` import, the `PriorityDisplay` type, the
`none` meta entry, and the fallback; type the map and `PriorityChip` as the
4-level `Priority` union only.

### Status icon vs status dot

Both live entirely in `-project-issues-tab.tsx`:

- `StatusIcon` component (`:133`) — inline SVG glyph per status, tints from
  `STATUS_ICON_TINT` (`:71`). Used by the list section header (`:390`) and rows
  (`:423`).
- `STATUS_DOT` (`:80`) — `bg-*` dot map used ONLY by the create-dialog status
  selector trigger (`:663`) and dropdown items (`:670`).

Scan result: `STATUS_DOT` / status-as-dot exists in no other file (procurement
create uses a `Select` with no status dot). Change 2 is fully contained in this
one file.

## Proposal

ONE combined L3 worktree subtask (both changes touch the same file):

- **FIX-018 + FIX-019 (single L3)** — priority default→low + remove `none`
  fallback + unify status icon.

## Acceptance Criteria

- Create-issue AND create-procurement default priority is `low`; backend issue
  & procurement schema/service defaults are `low`; affected backend tests
  updated to expect `low` and pass.
- `priority-signal.tsx` is 4-level only (`low|medium|high|urgent`): no `none`
  type, meta entry, `Minus` import, or fallback; stays `react-refresh`-safe
  (`PRIORITY_META` module-private).
- Create dialog priority dropdown lowest selectable is `low` (default-selected);
  no `无优先级 / No priority` option exists (none ever existed as a selectable).
- Create-dialog status selector (trigger + dropdown items) renders `StatusIcon`,
  identical to the list; `STATUS_DOT` deleted; exactly one status-icon
  representation app-wide.
- Status ENUM and status COLORS (`status-colors.ts`) unchanged.
- `bun run check` exits 0 (the `@milkdown/ctx` removeEventListener teardown in
  `-project-issue-panel.test.tsx` is a KNOWN FLAKE — grep to confirm before
  treating a test exit 1 as real).

## Out of Scope

- Adding a real `none`/`无优先级` priority level.
- Changing the status enum or status colors.
- Any module beyond project issues + procurement priority/status surfaces.
