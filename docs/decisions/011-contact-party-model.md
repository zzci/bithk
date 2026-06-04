# 011 — Contact single-table Party model

- Status: accepted
- Date: 2026-06-03
- Review by: 2026-12-01
- Scope: the shape of the contact module's data model — one `contacts` table
  storing both people and organizations, discriminated by `kind`; how the
  employer link, the avatar/logo image, and arbitrary custom properties are
  stored. Supersedes the prior "company row + single `contact_person` string"
  model.
- Related: PLAN-068 (contact single-table Party model), campaign
  l1-8odd9we3-contactmodel-20260603193747. Supersedes the contact data model
  from PLAN-013.

## Context

The contact directory previously modeled a contact as a single row whose `name`
was a company and whose only person field was a free-text `contact_person`
string. This conflates two distinct entities — an **organization** (a company /
unit) and an **individual** (a person) — and cannot express:

- More than one person at an organization.
- A person's own fields (position, personal phone, personal email).
- The relationship "this person works at that organization".

We want both individuals and organizations to be first-class contacts, with
people linkable to their employer, and we want it without a heavy schema. The
project is in its **dev phase**: backward compatibility is explicitly not a
concern, the DB may be reset freely, and the drizzle baseline can be rebaked
(see [project_dev_phase_breaking_ok], decision context shared with 010).

## Decision

### 1. Single-table Party model with a `kind` discriminator

Store both entity types in **one `contacts` table** with a NOT NULL `kind` enum
`{ individual, organization }`. Common columns apply to both; kind-specific
columns are nullable and populated only for the relevant kind:

- Individual-only: `phone`, `email`, `position`, `organizationId`.
- Organization-only: `taxId`, `address`. (`phone` is allowed on both kinds.)

A person's employer is a **self-foreign-key** `organizationId` →
`contacts.id` (referencing a `kind = organization` row), `ON DELETE SET NULL`.

### 2. `kind` is immutable after create

A row's `kind` is chosen once at creation and cannot be changed. Switching kinds
would orphan kind-specific columns and self-FK links and has no real-world
meaning (a person does not become a company). The create form selects the kind;
the edit form hides the selector.

### 3. Custom properties as a JSON `attributes` column

Arbitrary per-contact fields live in a single TEXT `attributes` column holding a
**flat JSON object** of `string -> string` pairs. The backend validates on write
that the payload parses to a flat, string-valued object; `null` / empty is
tolerated.

### 4. Avatar / logo reuse the file-reference cover pattern

A single nullable `avatarReferenceId` → `file_references.id` (`ON DELETE SET
NULL`), with file-reference `owner_type = 'contact_avatar'`, mirrors
`projects.cover_reference_id` / `owner_type 'project_cover'`. The same image is a
person avatar or an org logo by `kind`, reusing the existing `file` module and
the shared `CoverImage` / `CoverField` components.

### 5. Dev-phase breaking baseline rewrite

The `contacts` schema is rewritten in place, the `contact_person` column is
removed, and the drizzle baseline is rebaked into a single squashed `0000`
migration. No migration path, no compat shims; the dev DB is reset and reseeded
with sample organizations + linked individuals.

## Rationale

- **One table fits a fixed, small type set.** There are exactly two party kinds
  with mostly-overlapping fields. A single discriminated table keeps every
  shared concern (visibility, confidential masking, ownership/policy, tags,
  category, status, search, pagination, the unified panel/list UI) written
  **once** and shared by both kinds — no duplicated CRUD, no union queries, no
  cross-table joins to list "all contacts". Procurement's `supplier_id` keeps
  pointing at one id space (`contacts.id`) regardless of kind.
- **Self-FK is the minimal employer link.** The person→org relationship is a
  single nullable column resolved with one self-join; `ON DELETE SET NULL`
  detaches people cleanly when an org is removed without cascading deletes of
  people.
- **`kind` immutability turns an invalid state into a non-state.** Disallowing
  kind switches removes a whole class of "individual with a `taxId`" / dangling
  self-FK bugs structurally rather than by validation.
- **JSON `attributes` absorbs open-ended fields without schema churn.** Custom
  per-contact properties are inherently variable; a flat `string -> string` map
  covers them without a migration per request. Constraining to flat + string
  values (validated on write) keeps it queryable-enough, predictable, and
  trivially round-tripped by an add/remove-row editor.
- **Reusing the cover pattern means zero new image infrastructure.** The file
  module already provides dedup, owner-type-gated download, ref-count GC, and the
  `CoverImage`/`CoverField` components are battle-tested on projects and ships.
- **Dev phase makes the rewrite cheap.** With no production data and a freely
  resettable DB, a squashed baseline is simpler and cleaner than an additive
  migration that would carry the dead `contact_person` shape forward.

## Alternatives considered

- **Separate `individuals` and `organizations` tables.** Rejected for this
  scope: it duplicates every shared concern (policy, tags, category, visibility,
  confidential masking, search, the panel/list UI) across two tables, forces a
  union or two queries to list "all contacts", and splits the id space that
  `procurement.supplier_id` references. The clean separation buys little when the
  two types share the large majority of their columns and all of their access
  semantics. It becomes the right shape only if the two kinds diverge sharply in
  behavior — see Sunset / review.
- **Class-table inheritance (a base `contacts` row + a per-kind detail table).**
  Rejected as over-engineered at two kinds with a handful of kind-specific
  nullable columns: it adds a join on every read for no integrity gain the
  nullable-columns form does not already provide in practice.
- **A typed/normalized custom-attributes table `(contact_id, key, value)`.**
  Rejected as premature: custom attributes are display-only flat key/values with
  no per-key querying or indexing requirement today. A JSON column is simpler to
  read, write, and edit; the normalized table is the migration target if
  per-attribute querying/uniqueness is ever required.
- **A free-text `contact_person` retained alongside individuals.** Rejected: it
  reintroduces the exact ambiguity this redesign removes and would let the same
  person exist as both a string and a row.
- **Mutable `kind`.** Rejected: enables invalid cross-kind states (an individual
  carrying `taxId`, a self-FK pointing at a now-individual row) for no real use
  case.

## Sunset / review

Revisit by **2026-12-01**. Split into separate `individuals` /
`organizations` tables (or class-table inheritance) **if** the two kinds diverge
materially in behavior — e.g. distinct policy namespaces, distinct lifecycle, or
many kind-specific columns that make the shared table mostly-null. Migrate the
`attributes` JSON to a normalized `(contact_id, key, value)` table **if**
per-attribute filtering, indexing, or uniqueness becomes a requirement. As a
dev-phase decision, any such change is a breaking rewrite with no backfill
obligation and would supersede this decision rather than extend it.

This supersedes the prior contact data model (company row + single
`contact_person`) recorded in PLAN-013.
