---
id: REFACTOR-009
title: Unify tags into the central tag module
plan: PLAN-043
status: In Progress
owner: unassigned
created: 2026-05-31
updated: 2026-05-31
---

# Unify tags into the central tag module

## Context

See [PLAN-043](../plan/PLAN-043.md). PLAN-031 centralized the tag *vocabulary*
into a dedicated `tag` module but left each domain owning its own join table
(`project_tags`, `contact_tags`, `issue_tags`, `document_tags`,
`procurement_tags`). Tag storage is therefore still scattered, and every new
taggable domain must add another table and binding. This refactor removes the
per-domain tables so the tag module owns both the vocabulary and the assignment
storage.

## Scope

- Rename `tags.source_type` to `tags.type` (`sourceType` -> `type`,
  `TAG_SOURCE_TYPES` -> `TAG_TYPES`, `TagSourceType` -> `TagType`); values
  unchanged.
- Add one generic `tags_refs(resource_id, tag_id)` table in the tag module: PK
  `(resource_id, tag_id)`, index on `tag_id`, `tag_id` FK -> `tags.id`
  `ON DELETE CASCADE`, no FK on `resource_id`.
- Delete `project_tags` / `contact_tags` / `issue_tags` / `document_tags` /
  `procurement_tags`.
- Collapse `ResourceTagBinding` to `{ type }` over the shared table; refactor
  `tag.service.ts` and `tag.registry.ts` accordingly.
- Migrate project / contact / issue / document / procurement onto `tags_refs`
  and add application-level `tags_refs` cleanup on each resource delete.

## Implementation Notes

- Breaking schema change accepted (dev stage, no data migration; DB reset).
- `resource_id` has no FK; the source type is derived from the joined tag row.
- Resource-id collisions across domains are avoided by globally-unique nanoids
  and type-scoped tag ids.
- API-core refactor and web alignment are implemented by sibling subtasks in the
  same campaign; this task tracks the documentation deliverable.

## Verification

- `bun run check` green.
- No per-domain tag table remains in the Drizzle schema; a single `tags_refs`
  table backs all five domains.
- Tag assignment, listing, and filtering exercised through project / contact /
  issue / document / procurement flows.

## Outcome

- In progress. The `tag` module owns the unified `tags_refs` storage and the
  renamed `type` field; domains bind and clean up tags through tag-module
  helpers behind the source registry.
