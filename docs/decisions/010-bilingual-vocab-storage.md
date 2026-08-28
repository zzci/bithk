# 010 — Bilingual vocabulary storage: parallel `name_zh` + `name_en` columns

- Status: accepted
- Date: 2026-06-03
- Review by: 2026-12-01
- Scope: how the new `equipment_categories` vocabulary table stores its
  bilingual (zh / en) display names. Does **not** change how the existing
  single-name vocabularies (`worklists`, `contact_categories`, procurement
  categories, the former `ship_equipment.category` free text) store their names.
- Related: campaign l1-u6oar74v (ship equipment categories — bilingual,
  GLOBAL admin-managed vocab; the former free-text `ship_equipment.category`
  becomes a `categoryId` FK to this table).

## Context

The new `equipment_categories` table is the first piece of **user-managed
vocabulary** in this codebase that must carry a name in **both** supported
locales at once. Everything comparable so far has been single-name text:

- `worklists` — single `name` (KB-template vocab).
- `contact_categories` — single `name`.
- procurement categories — single `name`.
- the former `ship_equipment.category` — a single free-text string, now being
  replaced by a `categoryId` FK into this table.

So there is no existing bilingual-vocabulary precedent to follow, and a storage
shape has to be chosen deliberately. Two facts bound the decision:

1. The project's locale scope is **exactly two fixed locales** — `en` and `zh`.
   There is no runtime-pluggable locale set and no roadmap entry for a third.
2. The names must be **queryable and uniquely indexable per language** — the
   admin UI lists/sorts by the active locale and must reject duplicate category
   names within a language.

## Decision

Store the bilingual name as **two parallel columns** on `equipment_categories`:

- `name_zh` — **NOT NULL**, with its own **unique index**.
- `name_en` — **NOT NULL**, with its own **unique index**.

Both names are mandatory (a category cannot exist in only one language), and
uniqueness is enforced independently per language at the database level.

This bilingual two-column pattern applies **only** to `equipment_categories`
for now.

## Rationale

- **Simplest queryable, indexable, typed form for a fixed 2-locale scope.** Two
  `NOT NULL` columns let the app `ORDER BY` / filter on the active locale
  directly, enforce per-language uniqueness with a plain unique index, and get
  compile-time-typed, non-null fields with no decode step — all without a join
  or a JSON accessor.
- **Validation is structural, not conventional.** `NOT NULL` + unique index
  make "both languages present" and "no duplicate name per language" database
  invariants rather than application-only checks.
- **No premature generality.** With the locale set fixed at two, a generic
  translations mechanism buys flexibility the project does not need and pays for
  it in joins and query complexity on every read.

## Alternatives considered

- **Single JSON column `{ zh, en }`.** Rejected: a JSON blob is not uniquely
  indexable per language (no per-locale unique constraint), is awkward to
  `ORDER BY` / filter on, and pushes "both keys present and non-empty"
  validation entirely into application code. Weaker integrity for no real gain
  at two locales.
- **Separate translations table `(entity_id, locale, value)`.** Rejected as
  over-engineered for a fixed 2-locale scope: it adds a join to every read,
  needs a composite uniqueness rule to enforce per-locale uniqueness, and solves
  a runtime-variable-locale problem the project does not have. It is the right
  shape **if** the locale set ever becomes open-ended — see Sunset / review.

## Scope note

This decision deliberately does **not** retrofit the existing single-name
vocabularies. `worklists`, `contact_categories`, and procurement categories keep
their single `name` column; they are not bilingual today and there is no current
requirement to make them so. If a future need arises to make one of them
bilingual, this same `name_zh` / `name_en` pattern is the default to follow (or
the translations-table migration below, if the locale scope has changed by
then) — as a separate, explicitly-scoped change rather than an implicit
side effect of this one.

## Sunset / review

Revisit by **2026-12-01**, and immediately upon the introduction of a **third
locale**. If a third locale is ever added, migrate `equipment_categories` (and
any other vocabulary that has since adopted the parallel-column pattern) to a
normalized **translations table `(entity_id, locale, value)`** with a unique
`(entity_id, locale)` constraint, drop the `name_zh` / `name_en` columns, and
supersede this decision rather than adding a `name_xx` column per language. This
is a dev-phase decision: breaking changes are acceptable and the DB may be reset
freely, so the migration would carry no backfill obligation.

## Addendum (2026-06-03) — Global template + per-instance copy

Equipment categories are no longer a single global vocabulary referenced
directly by equipment. They now follow the project `procurement_categories`
pattern of an **admin global template copied per-instance on create**:

- `global_equipment_categories` — the admin-maintained template (the original
  `equipment_categories` table, renamed). Admin-only CRUD under
  `/global-equipment-categories`. Bilingual names are globally unique here.
- `ship_equipment_categories` — a **per-ship** copy of the template, seeded into
  each ship inside its `createShip` transaction (copy-on-create). Names are
  unique **within a ship** (`(ship_id, name_zh)` / `(ship_id, name_en)`); two
  different ships may reuse the same names. CRUD is ship-access-scoped under
  `/ships/:shortId/equipment-categories` (read = base-project member, write =
  `project.manage`).
- `ship_equipment.category_id` references `ship_equipment_categories` (set null
  on delete), so each ship owns its own category set.

Later edits to the global template **do not** propagate to existing ships;
deleting a ship cascades its own category rows. This mirrors
`global_procurement_categories` → `procurement_categories` for projects.

## Addendum (2026-08-28) — re-keyed to `project_id` by the section fold

[ADR-015](./015-projects-as-sections.md) folded ships into projects. The
storage decision above is unchanged — both tables still carry parallel
`name_zh` / `name_en` columns — but the *keying and route surface* moved:

- read "per-ship" above as **"per project with the `equipment` section
  mounted"**. `ship_equipment_categories.ship_id` is now `project_id`; the
  unique indexes are `(project_id, name_zh)` / `(project_id, name_en)`.
- the copy is seeded by the `equipment` section's `provision` hook
  (`seedEquipmentCategoriesTx`), which runs on both the create-time preset and
  a later `mountSection` — not inside a `createShip` transaction, which no
  longer exists.
- CRUD moved from `/ships/:shortId/equipment-categories` to
  **`/projects/:projectId/equipment-categories`** (read = project member, write
  = `project.manage`), behind `requireSection("equipment")`.

See [modules/ship.md](../modules/ship.md).

The bilingual **parallel-columns** storage decision above (and the third-locale
sunset / review) is unchanged — both `global_equipment_categories` and
`ship_equipment_categories` carry the same `name_zh` / `name_en` columns.
