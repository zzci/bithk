# PLAN-032 Align project issues with the access issue reference

- Status: Implementing
- Task: [REFACTOR-006](../task/REFACTOR-006.md)
- Owner: BKD L2 (campaign l1-lsqiuvv9-20260528225223)
- Updated: 2026-05-28

## Objective

Copy the `/app/zzci/access` issue implementation 1:1 into the BITHK project
issue module — backend behavior, tests, and especially the list/detail UI —
keeping only project ownership and project-member assignment, and preserving the
attachment/comment upload experience.

## Acceptance — intentional deltas from access (confirmed by L1)

Align UI/backend with access 1:1 as the baseline, but keep these intentional
BITHK differences (do not remove or hide them):

1. Project ownership / project-scoped routes / project-member assignment.
2. Issue pin/unpin behavior.
3. Issue references behavior (incl. ship maintenance-orders).

Where access has no equivalent (pin, references), integrate in the smallest way
that preserves existing BITHK behavior without disturbing the access-style main
issue list/detail/upload/comment flow.

## Approach

Decompose into three L3 subtasks plus L2-owned investigation/docs.

### L3-A — Backend parity (worktree)

Align `apps/api/src/modules/issue/*` to access:

- Match access service behavior for create/update/soft-delete/list/get,
  permissions (`resolveProjectIssueAccess` mirrors access `resolveAccess` plus
  membership gate), audit event names/details, comment mount, and attachment
  routes (upload/list/download/delete + comment attachments).
- Keep project scoping: `project_id`, `assignee_member_id`, project membership
  gates, project-scoped routes.
- Keep pin/unpin and references routes intact (other modules depend on them).
- Port access backend test coverage (`issue.test.ts`, `issue.routes.test.ts`)
  adapted for project scope; ensure parity of asserted behavior.
- No hand-authored migrations; if schema deltas are needed, change Drizzle
  schema and regenerate, coordinating with CHORE-002/PLAN-030 (escalate if
  ambiguous).

Verify: focused `apps/api` issue/file/comment tests green.

### L3-B — Frontend parity (worktree)

Rebuild the project issue list + detail to match access 1:1, adapted for project
nesting/member assignment/upload:

- Replace the status-grouped collapsible list with the access-style flat list:
  search, status filter, priority filter, pagination, resizable right drawer,
  row click opens drawer, maximize to fullscreen detail route.
- Align the detail panel to access `-issue-panel.tsx`: inline title editor,
  inline meta row (status/priority/assignee/due-date), markdown description
  edit/save/cancel, comments, attachments via `ResourceFooterSections`.
- Adapt only: project path, project-member assignee picker, resource URL
  `projects/{projectId}/issues`. Preserve `useResourceAttachmentUpload`.
- Keep the pin row action as an isolated affordance (pending L1 confirmation).
- Keep shared `resource/*` components compatible with document/file callers.

Verify: focused frontend issue/resource tests green.

### L3-C — e2e, i18n, docs, final verify (worktree, deps: A, B)

- Port/align `tests/e2e/modules/issue/{issues,attachments,comment-attachments}.test.ts`
  adapted for project scope.
- Bring `locales/{en,zh}/issues.json` to access parity where UI requires it.
- Update `docs/modules/issue.md`, `docs/reference`, `docs/changelog`, and PMA
  docs to record the project-ownership delta and kept extras.
- Run focused tests and `bun run check`; report pre-existing unrelated failures.

## List UI refinement (user request, supersedes specific access list-layout details)

Access is the baseline for the detail/drawer/upload/comment flow, but the main
work-order **list** keeps a status-grouped/sectioned layout (NOT the access flat
table). Required list behavior:

1. Top toolbar: search and create action adjacent as the primary actions.
2. Remove the priority filter from the visible top filter controls.
3. Top status filters remain and are clickable.
4. Each status section header is clickable and filters/selects that status,
   consistently with the top status filter.
5. Status group/header rows are full-width visual bars with a clear background
   and polished spacing.
6. Improve overall list layout and spacing.

Kept intact: project scoping, pin/unpin, references + maintenance-orders, file
upload/comment attachments, member assignment, and the access-style detail
panel/drawer/fullscreen/inline-edit flow. This refinement is folded into L3-B
(same files) to avoid concurrent edits.

## Dependency DAG

- A (backend) and B (frontend) run in parallel (separate `apps/api` vs `apps/web`
  trees, no file overlap). B targets the existing project-scoped API contract,
  which the access alignment preserves.
- C depends on A and B (integration: e2e + docs + final check).

## Risks

- Cross-module breakage if pin/references are removed — mitigated by keeping
  them; escalated to L1 for confirmation.
- Resource component changes could break document/file callers — constrain B to
  additive/compatible changes only.
- Migration ownership overlap with CHORE-002 — avoid generating migrations;
  escalate if schema changes are unavoidable.
