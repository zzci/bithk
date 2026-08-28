# FEAT-058 - Project documents: the documents module as a project section

- Status: Deferred (2026-08-28)
- Plan: [PLAN-110](../plan/PLAN-110.md)
- Depends on: [REFACTOR-039](REFACTOR-039.md)
- Created: 2026-08-28

## Status note

Deferred 2026-08-28: documents remain a top-level global module. See the
Deferral section of PLAN-110 for the revisit trigger.

## Goal

Documents have no project dimension today: they are Tier-C `items`
authorized by the Zanzibar policy engine, listed in one global owner-scoped
tree. Bring them into projects as a `documents` section:

- `document_details.project_id` (nullable) marks a document as living inside a
  project; global surfaces filter `project_id IS NULL`;
- the section registers from the document module's barrel with new
  `documents.view` / `documents.manage` capabilities, is added to both presets,
  and mounts `/projects/:id/documents*`;
- project documents are authorized by project capabilities only, resolved at a
  single branch point behind `documentAccess`; collaborator-share tuples are
  refused on them, public links stay;
- a Documents tab in the project reuses the existing tree + editor components.

## Scope

See PLAN-110. Out of scope: cross-boundary moves (personal <-> project,
project <-> project), per-document project sharing, promoting an existing
personal document into a project.

## Verification

- API: project document CRUD gated by the new capabilities; a non-member gets
  404; a removed member loses access even if an old tuple exists; parent must
  be in the same project; collaborator share refused with 422; public link
  still works.
- No leakage: `GET /documents`, `/documents/tree`, document search, pins and
  the share adapter all exclude project documents — one test per query.
- Attachment and comment permission hooks resolve through `documentAccess`, not
  raw tuples.
- Web: Documents tab visible only when mounted and `documents.view` held;
  editor works inside the project shell; overview tile present.
- Landing this must not touch `modules/project/` beyond the preset list — the
  acceptance test for the PLAN-108 section design.
- `bun run check` EXIT 0; generated api-docs / api-spec / api-types regenerated.
