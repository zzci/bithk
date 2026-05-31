# 006 — Unify tags into the central tag module (no per-domain tag tables)

- Status: accepted
- Date: 2026-05-31
- Review by: 2026-11-30
- Scope: `apps/api` tag module (`tag.service.ts`, `tag.registry.ts`,
  `ResourceTagBinding`, the `tags` and new `tags_refs` tables) and the
  project / contact / issue / document / procurement tag call sites
- Related: [PLAN-043](../plan/PLAN-043.md), [REFACTOR-009](../task/REFACTOR-009.md)

## Context

Tags began as a project-owned table, gained a `source_type` discriminator
(FEAT-015 / PLAN-023), and were then centralized into a dedicated `tag` module
(REFACTOR-005 / PLAN-031). That last step centralized the *vocabulary* — the
`tags` table, source-type validation, the `/tags` CRUD/list API behind a source
registry, and reusable assignment helpers — but left the *storage* scattered:
each domain still owned its own many-to-many join table (`project_tags`,
`contact_tags`, `issue_tags`, `document_tags`, `procurement_tags`), and
`ResourceTagBinding` was parameterized per table. Adding a new taggable domain
still meant adding another join table and another binding, and "where tags are
stored" was answered in five places.

## Decision

**No module may own its own tag join table. All tag storage and assignment go
through the central tag module (`apps/api/src/modules/tag`).**

Concretely:

- `tags.source_type` is renamed to `tags.type` (`sourceType` -> `type`,
  `TAG_SOURCE_TYPES` -> `TAG_TYPES`, `TagSourceType` -> `TagType`); values are
  unchanged (`project | contact | document | issue | procurement`).
- A single generic many-to-many table, `tags_refs(resource_id TEXT, tag_id
  TEXT)`, lives in the tag module: PK `(resource_id, tag_id)`, an index on
  `tag_id` for reverse lookup, `tag_id` FK -> `tags.id` `ON DELETE CASCADE`, and
  **no** FK on `resource_id` (it points at projects / contacts / items
  generically). The source type is derived from the joined tag row, not stored
  on the ref.
- The five per-domain join tables are dropped. No data migration; the dev DB is
  reset.
- `ResourceTagBinding` collapses to `{ type }` operating on the one shared
  table; the source registry keeps the tag module free of domain-schema imports,
  preserving the one-way dependency (domains -> tag, never the reverse).
- Because `resource_id` has no FK cascade, each domain cleans up its `tags_refs`
  rows at the application level on resource delete.

## Rationale

- **One shared tag module.** Vocabulary and storage now live in the same place;
  "where are tags stored" has a single answer.
- **No per-domain tag tables.** A new taggable domain registers a source type
  and reuses `tags_refs` — no new table, no new binding.
- **One-way dependency.** The source registry lets the tag module validate
  `type` without importing any domain schema, so the dependency arrow only ever
  points from domains into the tag module.
- Resource-id collisions across domains are avoided by globally-unique nanoids
  and type-scoped tag ids, so a generic `resource_id` is safe without an FK.

## Alternatives considered

- **Keep per-domain join tables (status quo after PLAN-031).** Rejected: leaves
  tag storage scattered across five tables and forces every new domain to add
  another — exactly the cost this decision removes.
- **One join table per type, still owned by each domain module.** Rejected:
  cosmetic — the ownership and duplication problem remains.
- **Polymorphic `tags_refs(resource_type, resource_id, tag_id)`.** Rejected as
  redundant: the type is already carried by the joined tag row, so storing it on
  the ref invites drift; the type is derived from the join instead.
- **Add an FK on `resource_id`.** Not possible: `resource_id` is polymorphic
  across projects / contacts / items, so no single FK target exists. Integrity
  is maintained by application-level cleanup on delete instead.

## Consequences

- Breaking schema change (dev stage, no data migration; DB reset).
- Orphaned refs are prevented by application-level cleanup rather than DB
  cascade, so every resource-delete path must remove its `tags_refs` rows.
- Future taggable domains register a source type and reuse `tags_refs` instead
  of adding a table.
- Reverse lookups (tag -> resources) are served by the `tag_id` index.

## Sunset / review

Revisit by **2026-11-30**. If a future requirement needs per-domain referential
integrity (a real `resource_id` FK) or per-domain tag columns, revisit whether
the single generic `tags_refs` table still fits, and update or supersede this
decision deliberately rather than by accident.
