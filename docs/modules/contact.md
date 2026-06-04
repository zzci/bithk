# Contact Module

> **Status: implemented (2026-06-03).** This
> document records the single-table **Party model** from
> [PLAN-068](../plan/PLAN-068-contact-party-model.md) and decision
> [011](../decisions/011-contact-party-model.md). It **supersedes** the prior
> "company row + single `contact_person` string" model (PLAN-013).

Global shared contact directory for suppliers, customers, subcontractors, and
other external parties. Contacts are not owned by projects. A contact is either
an **individual** (a person) or an **organization** (a company / unit),
discriminated by `kind`; an individual can be linked to its employer
organization. Procurement records reference this directory through `supplier_id`
(any kind), while classification uses the shared [`tag`](./tag.md) vocabulary
(scoped to tag type `contact`) plus a global `contact_categories` vocabulary.

## File layout

```text
apps/api/src/modules/contact/
  schema.ts                   # contacts (Party) + contact_categories
  contact.permission.ts       # contact namespace owner/viewer policy resource
  contact.service.ts          # CRUD, kind handling, org pick-or-create,
                              # attributes validation, visibility/masking, tags
  contact-category.service.ts # global contact-category vocabulary CRUD
  contact.routes.ts           # /api/contacts...
  contact.backup.ts           # backup contribution
  index.ts                    # route export + backup + file owner-type hook
  *.test.ts                   # co-located unit and route tests
```

## Database

### `contacts` (Party table)

One table holds every party. `kind` selects which optional columns apply.

| Column | Notes |
| ------ | ----- |
| `id` | nanoid PK. |
| `kind` | text enum `individual` / `organization`, **NOT NULL**. Discriminator; **immutable after create**. |
| `name` | **NOT NULL**. Person name (individual) or company/unit name (organization). |
| `note` | nullable free text. |
| `category_id` | nullable FK → `contact_categories.id`, `ON DELETE SET NULL`. |
| `owner_id` | creator user id. |
| `status` | `active` / `inactive`, default `active`. |
| `visibility` | `private` / `public`, default `private`. |
| `confidential` | boolean, default `false`. |
| `avatar_reference_id` | nullable FK → `file_references.id`, `ON DELETE SET NULL`. Person avatar OR org logo (see Shared image). |
| `attributes` | nullable TEXT, JSON object of flat `string -> string` custom properties (see Custom attributes). |
| `phone` | nullable. Allowed on **both** kinds. |
| `email` | nullable. Individual-only in the form. |
| `position` | nullable. Individual-only (job title / role). |
| `organization_id` | nullable **self-FK** → `contacts.id` (a `kind = organization` row), `ON DELETE SET NULL`. The individual's employer. Individual-only. |
| `tax_id` | nullable. Organization-only. |
| `address` | nullable. Organization-only. |
| `created_at`, `updated_at` | timestamps. |

Indexed by `owner_id` and `organization_id`. The old `contact_person` column is
**removed** — people are first-class `kind = individual` rows linked via
`organization_id` instead of a free-text string on a company row.

Kind-specific columns are not enforced as NULL at the DB level; the service
populates only the columns relevant to a row's `kind`.

### `contact_categories`

Global, admin-maintained classification vocabulary referenced by
`contacts.category_id`. `id` (nanoid), `name`, `code` (nullable), `description`
(nullable), timestamps. Standalone — not copied per project (unlike procurement
categories).

### Tags

Contact tag assignments live in the shared `tags_refs` join owned by the
[`tag`](./tag.md) module, keyed by `resource_id = contacts.id`, scoped to tag
type `contact`. There is no supplier/client/subcontractor enum and no `rating`
column.

## Shared image — avatar / logo

`avatar_reference_id` reuses the project-cover pattern: it points at a
`file_references` row with `owner_type = 'contact_avatar'` (mirroring
`projects.cover_reference_id` / `'project_cover'`). The module registers a file
owner-type hook for `'contact_avatar'` that gates download access to viewers of
the contact. The frontend reuses the shared `CoverImage` / `CoverField`
components; the single image renders as a person avatar or an organization logo
by `kind`. No new image infrastructure is added — the [`file`](./file.md) module
provides dedup, ref-count GC, and access gating.

## Custom attributes — `attributes` JSON

`attributes` stores a single-level JSON object of `string -> string` custom
properties. On write the service validates the payload parses to a **flat,
string-valued object**; `null` / empty object means "no custom attributes". The
form edits it as add/remove key-value rows. This absorbs open-ended per-contact
fields without a column per request.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/contacts` | List contacts visible to the caller. Filtering, search, pagination (see below). |
| POST | `/api/contacts` | Create a contact of a given `kind`. The caller becomes owner and an owner policy tuple is written. For an individual, may create + link a new organization inline (see Organization pick-or-create). |
| GET | `/api/contacts/:id` | Read one visible contact. Private contacts without access fail closed. |
| PATCH | `/api/contacts/:id` | Update fields, visibility, confidentiality, status, attributes, and tags. `kind` cannot be changed. Owner/admin only. |
| DELETE | `/api/contacts/:id` | Delete the contact, its tag links, and policy tuples. Owner/admin only. |
| POST | `/api/contacts/:id/avatar-image` | Set / replace the avatar-or-logo (multipart `file`). Owner/admin only. |
| DELETE | `/api/contacts/:id/avatar-image` | Remove the avatar-or-logo. Owner/admin only. |
| POST | `/api/contacts/:id/grant` | Grant explicit viewer access to exactly one `{ userId }` or `{ groupId }`. |
| POST | `/api/contacts/:id/revoke` | Revoke explicit viewer access for exactly one `{ userId }` or `{ groupId }`. |
| GET | `/api/contact-categories` | List the global contact categories. Admin only. |
| POST | `/api/contact-categories` | Create a contact category (`name`, optional `code`/`description`). Admin only. |
| PATCH | `/api/contact-categories/:id` | Update a contact category. Admin only; 404 if missing. |
| DELETE | `/api/contact-categories/:id` | Delete a contact category; referencing contacts have `category_id` set to NULL. Admin only; 404 if missing. |

`POST`/`PATCH` to `/api/contacts` accept `kind` (create only), the kind-relevant
fields, an optional `categoryId` (nullable), and an optional `attributes`
object. `categoryId` is always returned on the contact view regardless of
confidential masking.

### Organization pick-or-create

When creating an `individual`, the organization field accepts either an existing
`organization_id` or a new organization **name**. Given a new name, the service
creates a `kind = organization` contact carrying just that `name` (owned by the
caller) and links the individual to it via `organization_id`, in one
transaction — mirroring the tag combobox pick-or-create UX.

### `GET /api/contacts` query params

| Param | Description |
| ----- | ----------- |
| `q` | Search across name and note (matches raw stored values, not masked response fields). |
| `kind` | Filter by `individual` or `organization`. Omitted = all parties (all / individuals / organizations). |
| `status` | Filter by `active` or `inactive`. |
| `tagIds` | Repeatable (`?tagIds=a&tagIds=b`) or comma-separated (`?tagIds=a,b`) tag ids or names. Any-of match (union/OR). Capped at 50 values. |
| `categoryId` | Filter by contact category id. |
| `page` | 1-based page number. Omitted = full visible set (no pagination). |
| `limit` | Page size, default `20`, max `100`. |

`visibility` and `confidential` are **not** user-facing list filters; they
remain access-control attributes (see Permissions).

Response envelope: `{ success, data, meta: { total, page, limit } }`. `data` is
the array of visible contacts; `meta.total` is the total matching the filters.
`meta` is always present, including when `page` is omitted. The list is
person-primary in the UI (avatar + name), with organization name shown for
individuals; organizations also appear and are filterable via `kind`.

## Permissions

The module registers the `contact` policy namespace:

| Relation | Meaning |
| -------- | ------- |
| `owner` | Creator/manager. Grants read, update, delete, and share. |
| `viewer` | Explicit read grant for a user or group. Also implied by owner. |

Admins bypass contact checks. Non-admin access resolves from:

1. Row ownership (`contacts.owner_id`) or an explicit `owner` tuple.
2. Explicit `viewer` tuples for users or groups.
3. `visibility = 'public'`, which grants implicit read to any authenticated user.

Private contacts are visible only to owners/admins and explicit viewers. Public
contacts are readable by authenticated users. If a public contact is
`confidential = true`, implicit public viewers receive only `name`, `kind`,
`tags`, `visibility`, `confidential`, timestamps, and `canManage = false`;
detail fields (`phone`, `email`, `position`, `organizationId`, `taxId`,
`address`, `note`, `status`, `attributes`, `avatarReferenceId`) are masked to
`null`. Owners, admins, and explicit viewers see the full row.

## Procurement integration

Procurement `supplier_id` points at `contacts.id` for **any** kind. The
procurement module only validates that the contact exists; it does not require
the contact to belong to the project and does not check `kind`. Constraining the
supplier picker to `kind = organization` is a documented follow-up, not part of
this model.

## Audit

Write routes emit `contact.created`, `contact.updated`, `contact.deleted`,
`contact.access_granted`, and `contact.access_revoked` audit events with
`resourceType: 'contact'`. The admin category routes emit
`contact_category.created`, `contact_category.updated`, and
`contact_category.deleted` with `resourceType: 'contact_category'`.

## Backup

`contactBackupContribution` registers the `contacts` data module with tables
`contact_categories` then `contacts` (categories first so a restore inserts the
rows that `category_id` references before the contacts). The self-referencing
`organization_id` is satisfied within the single `contacts` table on restore.
It depends on `tags` (`deps ["tags"]`) so the shared `tags` vocabulary restores
before the tag join references it. Owner/viewer policy tuples are exported by the
`policies` contribution; avatar blobs are exported by the [`file`](./file.md)
module.
