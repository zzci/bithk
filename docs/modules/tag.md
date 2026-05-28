# Tag Module

Shared, type-scoped tag vocabulary. One module owns the `tags` table, the
source-type validation, the create / rename / delete / list APIs, the `/tags`
routes, and the reusable assignment helpers that every domain (project,
contact, document) uses to attach tags to its own rows.

The dependency direction is **one-way**: each domain registers its assignment
binding with the tag module; the tag module never imports a domain schema. This
lets project, contact, and document share one vocabulary table without
importing each other.

## File layout

```text
apps/api/src/modules/tag/
  schema.ts          # tags table + TAG_SOURCE_TYPES discriminator
  tag.service.ts     # vocabulary CRUD + reusable resource-assignment helpers
  tag.registry.ts    # source registry (registerTagSource / getTagBinding)
  tag.routes.ts      # /api/tags...
  tag.backup.ts      # backup contribution (tags only)
  index.ts           # route + registry exports, backup registration
  *.test.ts          # co-located service and route tests
```

## Database

| Table  | Purpose |
| ------ | ------- |
| `tags` | Central tag vocabulary. `id` (nanoid), `name`, `source_type` (`project` / `contact` / `document`), `created_at`, `updated_at`. Uniqueness is **type-scoped**: a unique index on `(source_type, name)`, not on `name` alone — each domain keeps an independent namespace within the one shared table. |

The per-domain join tables live in their owning modules, not here:

| Join table      | Owner                        | Links |
| --------------- | ---------------------------- | ----- |
| `project_tags`  | [`project`](./project.md)   | `project_id` ↔ `tag_id` |
| `contact_tags`  | [`contact`](./contact.md)   | `contact_id` ↔ `tag_id` |
| `document_tags` | [`document`](./document.md) | `item_id` ↔ `tag_id` |

Each join's `tag_id` references `tags.id` with `ON DELETE CASCADE`, so deleting
a tag unlinks every assignment automatically.

## Source registry

Domains do not import each other's schemas. Instead each registers an
assignment binding from its `routes/protected.ts` as a load-time side effect:

- `registerTagSource(binding)` — register (or replace) a domain's
  `ResourceTagBinding` (`{ sourceType, table, resourceColumn, tagColumn }`).
  Idempotent (last write wins) so dev HMR / test reruns are safe.
- `getTagBinding(sourceType)` — resolve a registered binding; throws if none
  is registered for the type.
- `listRegisteredSourceTypes()` — every source type with a binding.

The `/tags` routes resolve the join table for the requested `type` through
this registry, so the tag module never references a domain table directly.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`. The
optional `type` parameter is one of `project` / `contact` / `document` and
**defaults to `project`** so existing project-only callers are unchanged.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/tags?type=` | List the typed vocabulary with per-tag usage counts (most-used first, then by name). For the list-filter UI. |
| POST | `/api/tags` | **Admin only.** Create a tag in one source type. Body `{ name, type? }`. Rejects same-type duplicates. |
| PATCH | `/api/tags/:id` | **Admin only.** Rename a tag within its source type. Body `{ name, type? }`. Rejects same-type name collisions; 404 when the id is gone or belongs to another type. |
| DELETE | `/api/tags/:id?type=` | **Admin only.** Delete a tag; the join `ON DELETE CASCADE` unlinks every assignment (no in-use block). |

Tag names are trimmed and validated to 1–50 characters.

## Assignment helpers

`tag.service.ts` exposes reusable helpers that operate on a domain's binding so
each domain shares one implementation instead of hand-rolling its own join
logic. The tag module never imports a domain schema — the caller passes the
binding in.

| Helper | Purpose |
| ------ | ------- |
| `syncResourceTagsTx(tx, binding, resourceId, names, now)` | Replace one resource's tags: drop its join rows, then upsert each trimmed, non-empty, case-insensitively-deduplicated name into the shared vocabulary and re-link it. |
| `listResourceTagViews(db, binding, resourceId)` | Tags assigned to one resource as `{ id, name }`, ordered by name. |
| `listResourceTagNames(db, binding, resourceId)` | Tag names assigned to one resource, ordered by name. |
| `loadResourceTagsByResource(db, binding, resourceIds)` | Tags for a set of resources, grouped by resource id, each carrying the source-type-wide usage count. |
| `listResourceIdsByTag(db, binding, tagIdOrName)` | Resource ids assigned a given tag (by id or name) — for list filtering. |
| `resolveTagIdByIdOrName(db, sourceType, value)` | Resolve a value matching `tags.id` OR `tags.name` within a source type. |

The vocabulary-level operations (`createTag`, `renameTag`, `deleteTag`,
`listTagsWithUsage`, `upsertTagIdTx`) and the validation helpers
(`normalizeTagName`, `assertValidTagName`, `TAG_NAME_MAX`) are exported from the
same module.

## Backup

`tagBackupContribution` — table `tags` only, no deps (the table has no outbound
FKs). It must be inserted before every domain join table that references it, so
`project`, `contact`, and `document` list `tags` as a backup dep to enforce
ordering.
</content>
</invoke>
