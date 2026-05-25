# PLAN-018 Zen-mode issue detail panel redesign

- **status**: completed
- **createdAt**: 2026-05-25 17:30
- **approvedAt**: 2026-05-25 17:35
- **completedAt**: 2026-05-25 19:00
- **relatedTask**: UI-003

## Context

The user wants the issues page redesigned toward a zen-mode issue detail view,
reused everywhere an issue opens so there is no duplicated work.

Current findings:

- Issues live only inside the project module (REFACTOR-002 removed global
  issues). Every place that opens an issue routes to one of two surfaces, and
  both render the same component `ProjectIssuePanel`:
  - Drawer: `apps/web/src/app/routes/_app/projects/$projectId.issues.$issueId.lazy.tsx`
    (Sheet, `variant="drawer"`).
  - Fullscreen: `apps/web/src/app/routes/_app/projects/$projectId_.issues.$issueId.full.lazy.tsx`
    (`variant="fullscreen"`).
- The list entry `-project-issues-tab.tsx` `openIssue()` navigates to the drawer
  route. There are no other issue-detail entry points.
- Reuse is therefore already centralized: restyling `ProjectIssuePanel`
  propagates to both surfaces with no duplicated edits — this directly satisfies
  the "reduce duplicate modification" goal.
- The zen reference is `backup/untitled/project/tab-workorders.jsx` `WoDrawer`:
  chip+title header, a quiet KPI/meta strip, sectioned body (description,
  comments), and a footer. Its hours/deps/approval/checklist/materials are mock
  fields that do not exist in the real issue model and are out of scope.
- Real issue fields (from `-project-issue-hooks.ts` / projects API): title,
  description (markdown), status, priority, assigneeMemberId, dueDate,
  creatorId, createdAt, updatedAt, attachments, comments.

## Proposal

1. Restyle `apps/web/src/app/routes/_app/projects/-project-issue-panel.tsx` to a
   zen-mode layout while keeping its props, contract, and all handlers intact:
   - Header: status + priority chips, the editable title, and the existing
     action buttons (edit/delete/maximize/close, back in fullscreen).
   - Meta strip: a quiet, evenly spaced grid for assignee, due date, creator,
     created/updated — replacing the current cramped inline `·`-joined row.
     Editing affordances (Select / date picker) are preserved.
   - Description: a calm, well-spaced markdown block with the existing
     read/edit/empty states.
   - Footer: unchanged `ResourceFooterSections` (comments + attachments).
2. Make the layout variant-aware for a true zen feel:
   - `fullscreen`: center the content in a constrained max-width column
     (e.g. `max-w-3xl mx-auto`) with generous vertical rhythm.
   - `drawer`: keep the narrower in-sheet form; the Sheet width may be widened
     modestly if needed for the new strip, staying within current patterns.
3. Reuse existing shared primitives and tokens (Badge, Button, Select,
   MarkdownEditor, shadcn color tokens). No new shared UI primitives unless a
   change is strictly local and necessary.
4. Update `-project-issues-tab.test.tsx` only if a selector it relies on moves;
   otherwise leave tests untouched.
5. i18n: reuse existing `issues` namespace keys; add keys only if a new label is
   introduced, in both `en` and `zh`.

Out of scope:

- Backend/API/schema changes; new issue fields (hours, dependencies, approval
  flow, checklist, materials).
- The issues list/table redesign, kanban view, global sidebar, app shell, and
  unrelated modules.
- New dependencies.

## Alternatives

- Extract a brand-new shared `IssueDetail` component. Rejected: a shared panel
  already exists; a rewrite-in-place keeps the contract and avoids touching both
  route files.
- Also port the prototype's kanban + KPI features. Rejected: those depend on
  data the backend does not have and exceed the requested scope.

## Annotations

- 2026-05-25 17:30 - Investigation completed; awaiting approval to implement.
- 2026-05-25 17:35 - User approved implementation ("开始优化一下").
- 2026-05-25 19:00 - Implemented in `-project-issue-panel.tsx` (zen layout:
  action bar + chips/title + 4-field meta grid + spacious description) and
  widened the drawer route to `max-w-2xl`. No new i18n keys, no backend changes.
  Verified: web lint + typecheck clean, 402 web tests green, web build green.
