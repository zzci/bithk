# PLAN-110 - Project documents: the documents module as a project section

- Status: Proposed
- Task: [FEAT-058](../task/FEAT-058.md)
- Depends on: [PLAN-108](PLAN-108.md) (section registry + per-section capabilities)
- Campaign: single BKD L2 pair (api + web) expected; ~1.2k LOC
- Created: 2026-08-28

## Context (investigation, 2026-08-28)

- A document is a Tier-C sub-type of `items`: `items` holds title / status /
  creator / version / pin / soft-delete, `document_details` holds `content`,
  `parent_id` (business tree) and `comments_locked`
  (`modules/document/schema.ts:32-40`). Comments are `item_comments`,
  attachments are `file_references` with `owner_type = 'item_attachment'`.
- **Documents have no project dimension at all today** — no `projectId`
  anywhere in the document or item schema. The precedent for adding one is
  `issue_details.project_id` (`NOT NULL`, FK -> `projects`, `ON DELETE
  cascade`, indexed; `issue/schema.ts:40-46`).
- Authorization is the Zanzibar engine, not project capabilities:
  `documentAccess = defineResource({ namespace: "item", … })`
  (`document.permission.ts:42-60`) maps routes to actions to relations
  (`document:read` -> `viewer`, `document:update` -> `editor`,
  `document:delete` / `manage` -> `owner`). `viewer` is inherited down the
  tree through the `parent_item` `tuple_to_userset` rule
  (`policy/namespace-config.ts`), and per-user / per-group collaborator shares
  are tuples in the same namespace. Existence is owner-scoped: no read access
  means 404, not 403 (ADR-003).
- Group membership is *stored* as tuples (`addGroupMembership` /
  `removeGroupMembership`, namespace `group`, relation `member`) — there is no
  separate group-members table. Project membership is the opposite: a real
  `project_members` table with `role_id`, and capabilities resolved from
  `project_roles`.
- Document routes are all global (`/documents`, `/documents/tree`,
  `/documents/:id`, `…/move`, `…/pin`, `…/shares`), and the tree /
  list handlers are owner-scoped for everyone including admins
  (`document.service.ts:561`). Public links go through the share module
  (`document.share-adapter.ts`, `resource_type = 'document'`).
- Backup: contribution `documents` = `document_details` + `document_pins`,
  `deps: ["items", "policies", "tags", "users"]`.
- Module manifest: `documents` nav module claims `/documents` + `/shared`.

## Proposal

### Data model

`document_details.project_id`, nullable, FK -> `projects.id`, `ON DELETE
cascade`, indexed. `NULL` = a personal / global document (today's behaviour);
set = a document that lives inside that project. Same shape as
`issue_details.project_id`, one nullability difference because documents exist
outside projects too.

Every existing global surface (`GET /documents`, `/documents/tree`, the
document search source, the documents nav module) filters `project_id IS NULL`,
so project documents never leak into the personal tree.

### The section

`documents` registers from `document/index.ts` (ADR-009 barrel side effect):

- capabilities `documents.view` / `documents.manage` — the first section to
  actually use PLAN-108's capability contribution;
- no `provision` (a new project starts with an empty tree);
- `hasData` = "any non-deleted document with this `project_id`", so unmounting
  refuses while documents exist;
- added to both the `general` and `ship` presets.

Routes `/projects/:id/documents`, `/projects/:id/documents/tree`,
`/projects/:id/documents/:docId[/move|/pin|/shares]`, each behind
`requireSection("documents")`. They reuse `document.service.ts` unchanged apart
from the project filter; the global `/documents/*` routes stay for personal
documents.

### Authorization (the real decision)

A project document is authorized by **project capabilities only** — the policy
tuples are not consulted for it:

- `document:read` family -> `documents.view`; `document:update` / upload /
  comment -> `documents.manage`; delete / share-manage -> `documents.manage`.
- The branch lives in exactly one place: the resolver behind
  `documentAccess`, which reads `document_details.project_id` and routes to
  either the tuple check (NULL) or the project capability check (set). Route
  handlers, service functions and the web are unaware.
- `ItemService.createItem` keeps writing the `owner` tuple (it is how "my
  documents" works and it is free), but that tuple grants nothing on a project
  document.
- Per-user / per-group collaborator shares are **refused** on project
  documents (422 with a message pointing at project members): the project is
  the ACL, and a second authority over the same row is what makes permissions
  unpredictable. Anonymous public links still work, gated by
  `documents.manage`.
- Fail-closed existence is preserved: a caller without `documents.view` gets
  404 for a project document, exactly as a non-member gets 404 for the project.

### Tree and moves

`parent_id` must point at a document in the same project (or be NULL = project
root); the service validates this on create and move. Cross-boundary moves
(personal <-> project, project A <-> project B) are **out of scope for v1** —
they are a re-parenting *plus* a change of authorizing authority, and deserve
their own design (attachments, shares and pins would all need a rule).

### Web

- `documents` tab in the project detail (registry-driven, visible when mounted
  and `documents.view` held), rendering the same tree + Milkdown editor
  components as `/documents`, at `/projects/:id/documents/:docShortId`, so the
  project shell and tab nav stay in place — the same pattern the ship Files tab
  used to reuse `FileBrowser`.
- Project overview gains a documents tile (contributed by the section, per
  PLAN-108).
- The global `/documents` surface is untouched.

### Backup / search / gate

- Backup: the `documents` contribution gains `projects` to its `deps`; no
  table moves.
- Search: the document source splits — personal documents by tuple visibility
  (today's path), project documents by project membership, both merged into
  the existing `document` hit type carrying `projectId`.
- Module gate: project documents live under `/projects`, so they are gated by
  the `projects` nav module, not `documents`. A user granted `projects` but not
  `documents` sees project documents and no personal document nav. Intended;
  call it out in the changelog.

## Risks

- **Two authorities for one resource type.** Mitigated by a single branch point
  and by refusing collaborator shares on project documents; without both, the
  same document could be readable through a stale tuple after a member is
  removed from the project. A test must assert exactly that: remove the member,
  the tuple-shaped access is gone.
- **Leakage into global surfaces.** Every existing document query has to grow
  the `project_id IS NULL` filter — list, tree, search, pins, the share
  adapter's lookups. One missed query exposes project documents in the personal
  tree. Enumerate them from `document.service.ts` and cover each with a test.
- **Attachment / comment machinery is inherited unchanged** (`item_attachments`
  permission hook, `item_comments`), so their permission hooks must follow the
  same branch or they become the back door. Verify the item attachment hook
  resolves through `documentAccess`, not directly through tuples.
- **Capability seeding**: `documents.view` / `documents.manage` are new
  capabilities. Under PLAN-108's schema reset there are no existing roles to
  migrate, but the preset roles (Reader / Commenter / Writer) must be extended
  or new projects get a documents tab nobody but the owner can read.
- **Scope creep magnet**: cross-boundary moves, per-document project sharing,
  and "promote a personal document into a project" are all one small step away.
  They are explicitly deferred.

## Verification

This plan is also the acceptance test for PLAN-108's central claim: adding a
domain to projects must not require editing the project module. If landing
`documents` as a section touches anything under `modules/project/` beyond the
preset list, the section design has failed and should be revisited before more
sections are added.

## Alternatives

- **Tuple bridge (Option 2)**: register a `project` namespace with a `member`
  relation, mirror `project_members` into tuples, and grant project documents
  via `(item, docId, viewer, project, projectId#member)`. One authorization
  path instead of two, and it would support project members *plus* outside
  collaborators on the same document. Rejected for v1: it duplicates
  `project_members` into the tuple store (a new sync invariant on add / remove
  / role change) and moves document permissions outside the project capability
  model that every other section uses. Reconsider if cross-project document
  collaboration becomes a requirement.
- **Reuse `files.view` / `files.manage`** instead of new capabilities: fewer
  moving parts, but conflates the drive surface with documents in the roles
  editor, and makes it impossible to grant one without the other.
- **Keep documents global and just tag them with a project**: no new
  authorization story at all, but then project documents stay visible in the
  personal tree and inherit tuple-based sharing — i.e. not a project section,
  just a filter.
