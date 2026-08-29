# REFACTOR-040 - Project soft-delete cascade reaches into domain schemas

- Status: Proposed
- Plan: [PLAN-108](../plan/PLAN-108.md) (invariant this restores)
- Created: 2026-08-28

## Goal

PLAN-108 states the invariant that the project module imports no domain
module: sections register themselves from their owning module's barrel, and the
project module only ever calls them back through the registry hooks
(`provision`, `hasData`, `listSummary`).

`apps/api/src/modules/project/project.service.ts` breaks it. Its soft-delete
cascade imports two domain schemas directly:

```ts
import { issueDetails } from "@/modules/issue/schema";
import { procurementDetails } from "@/modules/procurement/schema";
...
const childItemIds = [
  ...tx.select({ itemId: issueDetails.itemId }).from(issueDetails).where(eq(issueDetails.projectId, project.id)).all(),
  ...tx.select({ itemId: procurementDetails.itemId }).from(procurementDetails).where(eq(procurementDetails.projectId, project.id)).all(),
];
```

This predates the section registry — it is not a regression from FIX-071 — but
it means the project module has to be edited every time a section grows
cascade-worthy rows, which is exactly what the section design exists to
prevent.

## Scope

- Add a `cascadeDelete` hook to `ProjectSectionDefinition`, alongside
  `provision` / `hasData` / `listSummary`: given a transaction and a project
  id, the section soft-deletes its own rows.
- Register it from `issue/index.ts` and `procurement/index.ts`; delete both
  domain imports from `project.service.ts` and have the cascade walk the
  project's mounted sections instead.
- Only sections actually mounted on the project run. Confirm this does not
  change today's behaviour for a project whose rows predate a section being
  unmounted — if it does, say so rather than silently changing the semantics.

Out of scope: changing what cascade deletion does (soft-delete semantics,
ADR-008 rules), and the `files` section, which cascades through drive's own
owner-scoped path.

## Verification

- `git grep "@/modules/(issue|procurement|ship|drive)" apps/api/src/modules/project/` returns
  nothing outside tests.
- Deleting a project still soft-deletes its issues and procurements — the
  existing cascade tests pass unchanged, plus one asserting a section that
  declares no `cascadeDelete` is simply skipped.
- A section mounted after rows exist still cascades correctly.
- `bun run check` EXIT 0.
