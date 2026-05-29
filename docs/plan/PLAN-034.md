# PLAN-034: Immutable lowercase project code placement

- Status: Done
- Task: UI-021
- Created: 2026-05-28

## Summary

Make the project code lowercase and immutable after creation, remove the editable
code field from General settings, and surface the code as a read-only, copyable
element pinned to the bottom of the project settings dialog left sidebar.

## Current State

- `createProjectTx` (`project.service.ts`) sets `code = input.code ?? P-${shortId.toUpperCase()}` - uppercase.
- `updateProject` patches `code` (in the `["code","name","status","description"]` loop) and `UpdateProjectInput` includes `code`.
- `updateProjectSchema` (`project.routes.ts`) accepts `code`.
- `-project-settings-general.tsx` renders an editable code Input and submits `code`.
- `-project-settings-dialog.tsx` owns the left-nav sidebar (good host for a bottom code display).
- `$projectId.lazy.tsx` already shows a lowercase-friendly copyable code chip in the title row (reuses `detail.copyCode`/`detail.codeCopied`/`detail.copyFailed`).
- `projects.ts` client `UpdateProjectInput` includes `code`.

## Approach (two parallel workstreams, disjoint files)

1. Backend immutability + lowercase (`apps/api/src/modules/project`):
   - `createProjectTx`: lowercase generated code (`p-${shortId.toLowerCase()}`) and
     normalize any supplied `input.code` to lowercase.
   - `updateProject`: drop `code` from the patched columns and from `UpdateProjectInput`.
   - `updateProjectSchema`: drop `code`.
   - Tests (`project.service.test.ts` / `project.routes.test.ts`): lowercase
     generation/normalization + update cannot change code.

2. Frontend placement + client (`apps/web`):
   - `-project-settings-general.tsx`: remove code state/field; stop submitting `code`.
   - `-project-settings-dialog.tsx`: read-only copyable code pinned at sidebar
     bottom-left; reuse `detail.copyCode` / `detail.codeCopied` / `detail.copyFailed`
     (add new keys only if needed); accessible label + existing toast conventions.
   - `projects.ts`: drop `code` from `UpdateProjectInput`.

No schema/migration change: the `code` column already exists and stays.

## Risks

- Shared main tree with sibling campaigns touching `project.service.ts` and project
  settings UI - both subtasks run in BKD worktree mode to isolate edits; merge in
  dependency order and verify sibling commits remain reachable.

## Verification

- Backend: `bun test` for the project module.
- Frontend: `bunx vitest run` for the touched files.
- Repo gate: `bun run check` attempted; unrelated campaign failures reported.
