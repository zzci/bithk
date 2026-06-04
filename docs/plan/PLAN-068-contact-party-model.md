# PLAN-068 Contact module single-table Party model

- **status**: Completed
- **owner**: l1-8odd9we3 / L2 8nj02f61 / L3 450st7wj (reconcile)
- **campaignId**: l1-8odd9we3-contactmodel-20260603193747
- **createdAt**: 2026-06-03

> Renumbered from the original PLAN-063 (that number was taken on `main` by an
> unrelated role-select fix). Re-expressed on top of current `main`: the change
> set adopts `main`'s shared gtag tag component family
> (`@/shared/components/tags`) for the contact list filter and form, and lands
> the schema change as an **additive forward migration `0002`** on top of the
> existing `0000`+`0001` chain (not the squashed-baseline rebake the original
> draft assumed).

## Goal

Redesign the contact module from the current "company row + single
`contact_person` string" shape into a **single-table Party model**: one
`contacts` table that stores both **individuals** (people) and
**organizations** (companies/units), discriminated by a `kind` column. An
individual can be linked to an organization (the person's employer),
and the form, list, and procurement integration all work against this one
table.

This is a dev-phase **breaking rewrite** — no migration path, no back-compat
shims. This supersedes the prior single-name + `contact_person` model recorded
in PLAN-013.

User-approved scope (the design below is settled; do not re-litigate it).

## Data model — single `contacts` table

One table holds every party. A `kind` discriminator selects which optional
columns apply.

### Discriminator

- `kind` — text enum `{ individual, organization }`, **NOT NULL**.
  Immutable after create: a row's kind cannot be switched (an individual never
  becomes an organization, or vice-versa). The create form picks the kind once;
  edit hides the kind selector.

### Common columns (both kinds)

- `id` (nanoid)
- `kind` (above)
- `name` — **NOT NULL**. For an individual this is the person's name; for an
  organization it is the company/unit name.
- `note` — nullable free text.
- `visibility` — `private` / `public` (unchanged access semantics).
- `confidential` — boolean (unchanged field-masking semantics).
- `status` — `active` / `inactive`.
- `categoryId` — nullable FK → `contact_categories.id` (`ON DELETE SET NULL`).
- `ownerId` — creator user id.
- `avatarReferenceId` — nullable FK → `file_references.id` (`ON DELETE SET NULL`);
  see Shared image below. One image used as a person avatar OR an org logo.
- `attributes` — nullable TEXT holding a JSON object of arbitrary flat
  `string -> string` custom properties; see Custom attributes below.
- `createdAt`, `updatedAt`.
- Tags via the existing shared tag join (`tags_refs`, `resource_id = contacts.id`,
  scoped to tag type `contact`) — unchanged.

### Individual-only columns (nullable)

- `phone` — also allowed on organizations (see note).
- `email`
- `position` — job title / role at the organization.
- `organizationId` — **self-FK** → `contacts.id` where the referenced row has
  `kind = organization`, `ON DELETE SET NULL`. The person's employer.

### Organization-only columns (nullable)

- `taxId`
- `address`
- `phone` — phone is allowed on **both** kinds (an org has a switchboard, a
  person has a mobile), so it is a common-ish column populated by both forms.

### Removed

- The old `contactPerson` column and the "name = company + single
  `contactPerson`" model are **removed entirely**. People become first-class
  `kind = individual` rows linked to an organization, instead of a free-text
  field on a company row.

## Shared image — avatar / logo via `file_references`

A single nullable `avatarReferenceId` column reuses the project-cover pattern:

- `contacts.avatar_reference_id` → `file_references.id`, `ON DELETE SET NULL`
  (mirrors `projects.cover_reference_id` → `file_references.id`).
- `owner_type = 'contact_avatar'` for the file-reference rows (mirrors
  `'project_cover'`). A `contact-avatar.permission.ts` hook gates download
  access (read follows contact read; manage follows contact update).
- The service-layer set/remove flow mirrors the project cover
  (`uploadAndReference` → repoint `avatar_reference_id` → release the previous
  reference → finalize), and the contact row release on delete frees the image.
- The frontend renders the image with a dedicated `ContactAvatar` control inside
  the contact panel (shadcn `Avatar` + `useSetContactAvatar` /
  `useRemoveContactAvatar`); the shared `CoverField`/`CoverImage` components are
  left untouched.

No new file infrastructure is introduced — the existing `file` module
(`uploadAndReference`, owner-type hooks, GC sweep) is reused as-is.

## Custom attributes — `attributes` JSON

- `attributes` is a TEXT column storing a JSON object of arbitrary flat custom
  properties: a single-level `{ "key": "value", ... }` map where every value is
  a string.
- The backend validates on write that the payload parses to a **flat
  `string -> string` object** (no nesting, no non-string values). `null` / empty
  object is tolerated (treated as "no custom attributes").
- The form edits this as add/remove key-value rows, serialized to the JSON
  object. This covers per-contact fields the fixed schema does not model without
  adding columns per request.

## Organization pick-or-create

In the **individual** form, the organization (employer) field is a combobox that:

1. Lists existing `kind = organization` contacts to pick from, and
2. Lets the user type a **new** organization name to create one inline. Creating
   inline writes a `kind = organization` contact carrying just that `name`, then
   links the individual via `organizationId`.

This mirrors the existing tag combobox pick-or-create UX (type-to-create), so
users never have to leave the person form to register a missing employer.

## Form — two kinds, sectioned

A single form with a **kind selector** at the top (disabled on edit). The body
swaps sections by kind:

- **Individual**: avatar + name + position + phone + email + organization
  pick-or-create + custom-attributes editor + note + common fields
  (visibility / confidential / status / category / tags).
- **Organization**: logo (same avatar control) + name + taxId + address +
  phone + custom-attributes editor + note + common fields.

The custom-attributes editor is an add/remove key-value row list serialized into
the `attributes` JSON object. Tags are edited with the shared `TagInput` from the
gtag tag family.

## List — person-primary

- Primary cell: avatar + name + kind badge.
- Columns: organization name (for individuals), phone / email, category, tags
  (`TagChips`), status.
- A **kind filter** (all / individuals / organizations) lets the user show all
  parties, only people, or only organizations. Organizations also appear in the
  list and are filterable.
- Search by name.
- Pagination and the existing filters (status, category, tags) are kept; the tag
  filter is the shared `tagFilterDimension` from the gtag tag family.
- Reuses the shared frontend primitives: `ListFilter`, `SearchCreateBar`,
  `PaginationFooter`, `DetailPanelHeader`, `ResizableDrawer`, and the unified
  `ContactPanel` (create / view / edit in one resizable drawer).

## Procurement integration

- `procurement.supplierId` continues to reference `contacts.id` for **any**
  kind. The supplier picker keeps working and will list all contacts (both
  individuals and organizations) — acceptable in the dev phase.
- Optionally constraining the supplier picker to `kind = organization` is a
  documented **follow-up**, not part of this redesign. Procurement internals are
  **out of scope**.

## Database / migration

- The schema change lands as an **additive forward migration `0002`**, generated
  by `drizzle-kit` (`bun run db:generate`) on top of `main`'s existing
  `0000_tough_mandroid` + `0001_equal_stephen_strange` chain. SQLite's
  ALTER limits mean the `contacts` reshape (new `kind NOT NULL`, dropped
  `contact_person`, new self-FK + avatar FK + indexes) is expressed as a
  table-recreation migration.
- `_journal.json` and the snapshots end with the coherent `[0000, 0001, 0002]`
  chain; a fresh migrate runs clean (no orphan/duplicate baseline).
- The dev DB is reset/reseeded on restart (migrate-on-boot).
- The seed includes sample **organizations** plus **individuals linked** to them
  via `organizationId`, so the linked-party UX has data on a fresh DB.

## Scope / Constraints

- Backend: `apps/api/src/modules/contact/` (schema, service, routes, tests),
  the `contact-avatar` file `owner_type` hook registration, drizzle `0002`
  migration + snapshots, seed dataset.
- Frontend: the contacts list + the unified contact panel/form, the
  organization pick-or-create combobox, the custom-attributes editor, the kind
  filter, the `ContactAvatar` control, gtag tag family adoption, i18n en + zh
  parity, tests.
- Dev phase: breaking changes OK, DB resettable, no compat shims.
- Quality gate: `bun run check` EXIT 0 (fresh worktree may need `bun install`;
  only acceptable noise is the known @milkdown teardown flake).

## Acceptance Criteria

- `contacts` is a single table with a `kind` discriminator; individuals carry
  `phone`/`email`/`position`/`organizationId`, organizations carry
  `taxId`/`address`; both may carry `phone`, `avatarReferenceId`, and
  `attributes`. The old `contactPerson` column is gone.
- `organizationId` is a self-FK to a `kind = organization` row, `ON DELETE SET
  NULL`.
- The individual form's organization field can pick an existing org or create a
  new one inline (combobox pick-or-create), linking via `organizationId`.
- The form renders kind-specific sections; the custom-attributes editor round-
  trips to/from the `attributes` JSON object; the backend rejects non-flat /
  non-string-valued attribute payloads.
- The list is person-primary (avatar + name), exposes an
  all/individuals/organizations kind filter, keeps search + pagination +
  status/category/tag filters, and reuses the shared list/panel + gtag tag
  primitives.
- Avatar/logo uploads through `file_references` with `owner_type =
  'contact_avatar'`; download access gated by the file owner-type hook.
- `procurement.supplierId` still resolves against `contacts.id` for any kind;
  the supplier picker keeps working.
- The drizzle chain is `[0000, 0001, 0002]` (additive forward migration); seed
  contains sample organizations + linked individuals; `bun run check` EXIT 0.
- i18n en + zh parity for all new strings; English-only repository docs.

## Related

- Supersedes PLAN-013 (contacts as a global shared module) for the contact data model.
- Decision: [011 — Contact single-table Party model](../decisions/011-contact-party-model.md).
- Module doc: [contact](../modules/contact.md).
- Reuses the project cover pattern (`cover_reference_id` / `owner_type
  'project_cover'`) from the [file](../modules/file.md) + [project](../modules/project.md)
  modules.
- Adopts the shared gtag tag component family (PLAN-066,
  `@/shared/components/tags`).

## 2026-06-04 contactfields addendum

Campaign `l1-8odd9we3-contactfields-20260604081152` (backend L3) unifies the
editable field set across both kinds and enriches the individual view with its
employer's company data.

- **Shared field set widened.** `email`, `website` (new column), `taxId`, and
  `address` are now accepted on **both** kinds (joining `phone`/`note`). The
  prior gating — `email` individual-only, `taxId`/`address` organization-only —
  is removed. Only `position` and the organization link (`organizationId` /
  `organizationName` / `organizationAttributes`) stay individual-only; an
  individual now rejects nothing from the shared set, while an organization
  rejects the four individual-only fields.
- **`website` column.** Added to the `contacts` table (nullable, shared),
  masked like the other detail fields on confidential public reads.
- **Embedded `organization` summary.** An individual's view embeds a read-only
  `{ id, name, website, email, phone, address, taxId }` summary of its linked
  organization, masked by the **organization's own** visibility/confidential
  rules for the reading actor (`name` always present). Organizations and
  unlinked individuals return `null`.
- **`organizationAttributes` on inline-create.** When an individual creates its
  employer inline from `organizationName`, an optional `organizationAttributes`
  object seeds `website`/`email`/`phone`/`address`/`taxId` onto the new org row.
- **Migration.** The single `0000` baseline (collapsed on `main` at commit
  `3d99768`) is regenerated to include `contacts.website`; the chain stays a
  single baseline (no additive `0001`). This supersedes the original plan's
  "additive forward migration `0002`" note, which assumed the pre-collapse
  `0000`+`0001` chain.
- **Seed.** Top-level `website` populated on sample rows (the old
  `attributes.website` value moved out), and organization `email` seeded to
  exercise the now-shared org email.
- **Frontend (paired web L3).** The contacts list becomes single-line
  (`name | company | category`) and the person detail gains a Company info
  section fed by the embedded `organization` summary. Frontend work is owned by
  the web L3; this L3 is backend + docs only.
