# Contact Module

Global shared contact directory for suppliers, customers, subcontractors, and
other external parties. Contacts are no longer owned by projects. Procurement
records reference this directory through `supplier_id`, while classification is
handled with the shared [`tag`](./tag.md) vocabulary (scoped to
`source_type = 'contact'`).

## File layout

```text
apps/api/src/modules/contact/
  schema.ts              # contacts + contact_tags
  contact.permission.ts  # contact namespace owner/viewer policy resource
  contact.service.ts     # CRUD, visibility filtering, masking, tags, grants
  contact.routes.ts      # /api/contacts...
  contact.backup.ts      # backup contribution
  index.ts               # route export + backup registration
  *.test.ts              # co-located unit and route tests
```

## Database

| Table | Purpose |
| ----- | ------- |
| `contacts` | Global contact rows. `id` (nanoid), `owner_id` (creator), `name`, `contact_person`, `phone`, `email`, `address`, `tax_id`, `note`, `status` (`active`/`inactive`), `visibility` (`private`/`public`), `confidential`, timestamps. Indexed by `owner_id`. |
| `contact_tags` | Contact-to-tag assignment join. PK `(contact_id, tag_id)`, `contact_id` cascades with `contacts`, `tag_id` references the shared `tags` table (`ON DELETE CASCADE`) owned by the [`tag`](./tag.md) module. |

The module reuses the shared `tags` vocabulary (source type `contact`) rather
than defining contact types. There is no supplier/client/subcontractor enum and
no `rating` column.

## Routes

Mounted under `protectedRoutes`; every route requires `authRequired`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/contacts` | List contacts visible to the caller. Supports filtering, search, and pagination (see below). |
| POST | `/api/contacts` | Create a contact. The caller becomes owner and an owner policy tuple is written. |
| GET | `/api/contacts/:id` | Read one visible contact. Private contacts without access fail closed. |
| PATCH | `/api/contacts/:id` | Update contact fields, visibility, confidentiality, status, and tags. Owner/admin only. |
| DELETE | `/api/contacts/:id` | Delete the contact, its tag links, and policy tuples. Owner/admin only. |
| POST | `/api/contacts/:id/grant` | Grant explicit viewer access to exactly one `{ userId }` or `{ groupId }`. |
| POST | `/api/contacts/:id/revoke` | Revoke explicit viewer access for exactly one `{ userId }` or `{ groupId }`. |

### `GET /api/contacts` query params

| Param | Description |
| ----- | ----------- |
| `q` | Search across name, contact person, and note (matches the raw stored values, not the masked response fields). |
| `status` | Filter by `active` or `inactive`. |
| `visibility` | Filter by `private` or `public`. |
| `confidential` | Filter by `true` or `false`. |
| `tag` | Tag id or name. |
| `page` | 1-based page number. When omitted, the full visible set is returned (no pagination applied). |
| `limit` | Page size, default `20`, max `100`. |

Response envelope: `{ success, data, meta: { total, page, limit } }`. `data` is the
array of visible contacts; `meta.total` is the total count matching the filters.
`meta` is always present, including when `page` is omitted and the full set is
returned. Search matches the raw `name`/`contactPerson`/`note` values; response
field masking for confidential public contacts is unchanged (see Permissions).

## Permissions

The module registers the `contact` policy namespace:

| Relation | Meaning |
| -------- | ------- |
| `owner` | Creator/manager. Grants read, update, delete, and share. |
| `viewer` | Explicit read grant for a user or group. Also implied by owner. |

Admins bypass contact checks. Non-admin access is resolved from:

1. Row ownership (`contacts.owner_id`) or an explicit `owner` tuple.
2. Explicit `viewer` tuples for users or groups.
3. `visibility='public'`, which grants implicit read to any authenticated user.

Private contacts are visible only to owners/admins and explicit viewers.
Public contacts are readable by authenticated users. If a public contact is
`confidential=true`, implicit public viewers receive only `name`, `tags`,
`visibility`, `confidential`, timestamps, and `canManage=false`; contact
details (`contactPerson`, `phone`, `email`, `address`, `taxId`, `note`,
`status`) are masked to `null`. Owners, admins, and explicit viewers see the
full row.

## Procurement integration

Procurement `supplier_id` points at `contacts.id`. The procurement module only
validates that the contact exists; it does not require the contact to belong to
the project and does not check a contact type.

## Audit

Write routes emit `contact.created`, `contact.updated`, `contact.deleted`,
`contact.access_granted`, and `contact.access_revoked` audit events with
`resourceType: 'contact'`.

## Backup

`contactBackupContribution` registers the `contacts` data module with tables
`contacts` then `contact_tags`. It depends on `tags` (deps `["tags"]`) so the
shared `tags` vocabulary — backed up by the [`tag`](./tag.md) module — restores
before `contact_tags` references it. Owner/viewer policy tuples are exported by
the `policies` contribution.
