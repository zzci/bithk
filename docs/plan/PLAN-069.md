# PLAN-069 — Seed dataset full schema coverage on the party-model main

- Status: Completed
- Task: [DATA-001](../task/DATA-001.md)
- Campaign: l1-39msbb3u-seedfill2-20260603203000
- Created: 2026-06-04

## Problem

The curated seed dataset (`apps/api/scripts/seed/`) drifted behind the schema as
new columns and tables landed on the current party-model main. Several
service-backed fields and reference tables were never represented in the seed
payloads, so a freshly seeded database left whole feature surfaces empty:

- **G0** — procurements carried no tags (`tags_refs` had zero `procurement` rows).
- **G1** — no `contact_categories` rows; every contact had a NULL `category_id`.
- **G2** — no `global_procurement_categories` rows.
- **G3** — contacts never exercised the party-model extras: organization
  `tax_id` was sparse, and no contact set `status='inactive'` or
  `confidential=true`.
- **G4** — projects had no virtual members (`users.is_virtual` rows linked
  through `project_members`).
- **G5** — most `ship_equipment` rows lacked `serial_number` / `installed_at`.
- **G6** — no `issue_references` rows (worklist references on issues).

## Approach (SEED-ONLY)

Data-only. Every backing service, table, and route already exists on main, so the
fix is confined to the seed importer and its payload JSON plus these PMA docs. No
schema, migration, service, route, or UI changes.

- Extend the loose dataset type defs and accumulators in `seed.ts`.
- Port the non-contact importers/wiring from the prior reference branch
  (`bkd/2odutjuc`): `importContactCategories`, `importGlobalProcurementCategories`,
  `importIssueReferences`, virtual-member branching in `importProjects`,
  `seededWorklistRefs` / `seededIssueItemIds` collection, and procurement `tags`.
- Keep the current main's party-model `importContacts` (kind/org/taxId/address/
  attributes) and only thread `categoryId` / `status` / `confidential` through it.
- Seed `global_procurement_categories` AFTER `importProjects` so the
  copy-on-create in `createProject` (`seedProjectCategoriesTx`) does not duplicate
  the projects' own explicitly seeded categories.
- Enrich the payload JSON: tags on all procurement templates, a `category` on
  every contact, extra org `tax_id` + one `inactive` + one `confidential` contact,
  a virtual member per standalone project, and `serial_number` / `installed_at` on
  a majority of equipment.

## Verification

`bun run seed` runs clean (no ValidationError), the 13 acceptance DB probes pass,
and `bun run check` exits 0. See [DATA-001](../task/DATA-001.md) for the captured
numbers.
