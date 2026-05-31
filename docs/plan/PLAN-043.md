---
id: PLAN-043
title: Unify tags into the central tag module
status: Implementing
owner: unassigned
created: 2026-05-31
updated: 2026-05-31
supersedes: []
---

# Unify tags into the central tag module

## Problem / Goal

PLAN-031 promoted tags to a standalone `tag` module that owns the vocabulary,
validation, the CRUD/list API, and reusable assignment helpers. It stopped short
of one thing: each domain still owns its own many-to-many join table
(`project_tags`, `contact_tags`, `issue_tags`, `document_tags`,
`procurement_tags`) and the `ResourceTagBinding` is parameterized per table. The
vocabulary is centralized, but tag *storage* is still scattered across five
domain-owned tables, so every new taggable domain must add another join table
and another binding.

The goal is to remove per-domain tag tables entirely: the tag module owns both
the vocabulary and the assignment storage. No module may own a tag join table.

## Proposed Approach

1. Rename `tags.source_type` to `tags.type` (TS: field `sourceType` -> `type`,
   const `TAG_SOURCE_TYPES` -> `TAG_TYPES`, type `TagSourceType` -> `TagType`).
   Values are unchanged: `project | contact | document | issue | procurement`.
2. Add one generic many-to-many table in the tag module:
   `tags_refs(resource_id TEXT, tag_id TEXT)` with PK `(resource_id, tag_id)`,
   an index on `tag_id` for reverse lookup, `tag_id` FK -> `tags.id`
   `ON DELETE CASCADE`, and **no** FK on `resource_id` (it points at
   projects / contacts / items generically). The source type is derived from the
   joined tag row, not stored on the ref.
3. Delete the five per-domain join tables. No data migration; the dev DB is
   reset (breaking changes accepted, dev phase).
4. Refactor `tag.service.ts`, `ResourceTagBinding`, and `tag.registry.ts` so
   every domain assigns tags through the single `tags_refs` table via tag-module
   methods. The binding collapses to `{ type }` operating on the one shared
   table; resource-id collisions are avoided by globally-unique nanoids and
   type-scoped tag ids.
5. Each domain's resource-delete path cleans up its `tags_refs` rows at the
   application level, since `resource_id` carries no FK cascade.

## Scope

- Tag module: `type` rename, the `tags_refs` table, generic binding, registry.
- Drop `project_tags` / `contact_tags` / `issue_tags` / `document_tags` /
  `procurement_tags`.
- Migrate project / contact / issue / document / procurement onto `tags_refs`.
- Application-level cleanup of `tags_refs` on each resource delete.
- Web alignment: keep the tag picker / filter contracts working against the
  renamed `type` field and the unified storage.
- Docs: this plan, the task doc, the architecture rule, a decision record, and a
  changelog entry.

## Acceptance Criteria

- `tags.type` replaces `tags.source_type` end-to-end (schema + TS symbols).
- A single `tags_refs` table backs all five domains; no per-domain tag table
  remains in the schema.
- The tag module imports no domain schema; domains bind tags only through
  tag-module helpers.
- Resource deletes remove their `tags_refs` rows.
- `bun run check` green.

## Risks / Notes

- Breaking schema change accepted (dev stage, no data migration; DB reset).
- `resource_id` has no FK, so orphaned refs are prevented by application-level
  cleanup rather than DB cascade — every delete path must call the cleanup.
- Builds on, but does not supersede, PLAN-031 (which centralized the vocabulary;
  this plan centralizes the storage).

## Decomposition

- **API core**: `type` rename, `tags_refs` table, generic binding + registry,
  domain migration, delete-path cleanup, drop the five join tables.
- **Web alignment**: update tag picker / filter call sites to the renamed
  `type` field and unified storage; keep the existing UI contracts.
- **Docs**: this plan + task doc, the architecture "Tag ownership" rule, the
  decision record, and the changelog entry.
