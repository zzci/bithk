# PLAN-045 Create-issue dialog optimization + priority icon refresh

- **status**: Implementing
- **owner**: l1-75ymcfnr / L2 mh18btcp
- **campaignId**: l1-75ymcfnr-issuedlg-20260601234538
- **tasks**: [FIX-016](../task/FIX-016.md), [FIX-017](../task/FIX-017.md)
- **createdAt**: 2026-06-01

## Goal

Two focused frontend changes on the project issues surface:

1. Refresh the priority indicator into a **background-backed icon** (a small
   rounded chip with a tinted background containing a lucide signal-bar icon),
   replacing the bare colored dot, as the single source of truth shared by the
   issues list, procurement list, and the create-issue dialog picker.
2. Bring the create-issue dialog/composer up to the Linear-style target layout
   (breadcrumb header, borderless title/description, a single pill row of
   metadata selectors, and a footer action bar) by implementing only the gaps
   versus the current implementation.

## Investigation

### Priority visual (current)

`apps/web/src/shared/components/priority-signal.tsx` exports two
module-private-meta components:

- `PrioritySignal({priority,label})` — `size-2.5` solid filled circle with
  `title`/`aria-label`. Used by the issues list row
  (`-project-issues-tab.tsx:428`) and the procurement list row
  (`-project-procurement-tab.tsx:253`).
- `PriorityGlyph({priority})` — bare `size-2.5` dot, `aria-hidden`. Used by the
  create dialog priority pill trigger and dropdown items
  (`-project-issues-tab.tsx:625,632`).

`PRIORITY_META: Record<Priority,string>` maps the 4-level union
(`low|medium|high|urgent`) to `bg-*` tokens (muted-foreground / info / warning /
destructive). It is kept module-private to stay `react-refresh`-safe.

### Create dialog (current vs target)

`CreateIssueDialog` (`-project-issues-tab.tsx:498-699`) already has: borderless
title `Input`, borderless `Textarea`, a wrapping pill row with status / priority
/ assignee / due-date `DropdownMenu` pills, a sticky footer with Cancel +
Create. It is wrapped in `Dialog`/`DialogContent` with an `sr-only`
`DialogTitle`.

Gaps versus the Linear target: breadcrumb header `{projectName} › 手动创建`
with expand + close icons; a footer attachment (paperclip) button; a
`继续创建` (keep-open) toggle and a `切换到智能体` toggle; the primary button
labelled `创建 issue`; and the priority pill inheriting the new icon (free via
req 1, no call-site change needed in the picker if the component signature is
kept stable).

## Priority-model decision (IMPORTANT)

L1 states the priority is a **4-level union** (`low|medium|high|urgent`) and is
the single source of truth. The Linear reference shows `无优先级 / No priority`
as a default, and req 2 lists a `none = dash` visual. To avoid a breaking
end-to-end enum/migration change for a UI-parity nicety, this campaign treats
`none` as a **display-only fallback** in `priority-signal.tsx` (the component may
render a neutral dash for an absent value) and **does not** add a selectable
`none` priority to the data model. The create dialog keeps a real 4-level
priority field (default `medium`, unchanged). This divergence is escalated to L1
as a decision point; if L1 wants a real `none` level it becomes a separate,
larger backend+frontend task.

## Proposal

Two L3 worktree subtasks. Both touch `-project-issues-tab.tsx`, so they are
**serialized**: FIX-016 first, then FIX-017 after FIX-016 merges into
`bkd/mh18btcp`, to avoid an intra-campaign merge conflict on that file.

- **FIX-016 (L3 eruxpw42)** — priority-signal redesign + sync all consumers.
- **FIX-017 (L3 ow1yzzpb)** — create-issue dialog Linear-style layout (deps FIX-016).

## Acceptance Criteria

- Priority renders as a tinted-background rounded chip + lucide signal-bar icon
  everywhere (issues list, procurement list, create-dialog picker), identical
  across surfaces, with medium and high clearly distinct (blue vs yellow).
- `priority-signal.tsx` stays `react-refresh`-safe (`PRIORITY_META` module-private).
- Create dialog gains the breadcrumb header, expand/close icons, footer
  paperclip, `继续创建` (functional keep-open) and `切换到智能体` toggles, and a
  `创建 issue` primary button, matching the target while implementing only the
  gaps.
- New strings added to BOTH `en` and `zh` `projects` locale namespaces with key
  parity (a parity guard exists).
- Each L3 self-verifies `bun run check` exits 0; L2 re-runs `bun run check` on
  `bkd/mh18btcp` after each merge.

## Out of Scope

- Adding a real `none` priority level to the backend/data model.
- Any module other than the project issues + procurement priority surfaces.
- Edits to shared status-color or other concurrent-campaign-owned files beyond
  the minimal, localized changes above.
- Wiring a real "create via AI agent" backend for the `切换到智能体` toggle.
