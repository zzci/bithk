# DATA-001 — Seed dataset full schema coverage (G0–G6)

- Status: Completed
- Plan: [PLAN-069](../plan/PLAN-069.md)
- Campaign: l1-39msbb3u-seedfill2-20260603203000
- Owner: L3 qfxekaje dispatch
- Created: 2026-06-04

## Summary

Bring `apps/api/scripts/seed/` to full schema coverage on the current
party-model main. Data-only: the importer (`seed.ts`) and payload JSON were
extended; no schema/migration/service/route/UI changes. The reference branch
`bkd/2odutjuc` supplied the non-contact importers verbatim; `importContacts`
stayed on the current party model and was only extended with category / status /
confidential.

## Scope (files)

- `apps/api/scripts/seed/seed.ts`
- `apps/api/scripts/seed/payload/contacts.json`
- `apps/api/scripts/seed/payload/procurement-templates.json`
- `apps/api/scripts/seed/payload/ships.json`
- `apps/api/scripts/seed/payload/projects.json`
- `apps/api/scripts/seed/payload/contact-categories.json` (new)
- `apps/api/scripts/seed/payload/global-procurement-categories.json` (new)
- `docs/plan/PLAN-069.md`, `docs/task/DATA-001.md`, plan/task index rows

## Acceptance criteria

- [x] 1. `contact_categories` count >= 5 — **5**
- [x] 2. `contacts WHERE category_id IS NULL` == 0 — **0**
- [x] 3. `contacts WHERE kind NOT IN ('individual','organization')` == 0 — **0**
- [x] 4. `contacts WHERE kind='organization' AND tax_id IS NOT NULL` >= 3 — **4**
- [x] 5. `contacts WHERE status='inactive'` >= 1 — **1**
- [x] 6. `contacts WHERE confidential=1` >= 1 — **1**
- [x] 7. `contacts WHERE attributes IS NOT NULL` >= 1 — **2**
- [x] 8. `global_procurement_categories` count >= 6 — **6**
- [x] 9. virtual project members (`is_virtual=1` via `project_members`) >= 8 — **8**
- [x] 10. `ship_equipment` with both `serial_number` and `installed_at` is a
       majority of all `ship_equipment` — **31 / 38**
- [x] 11. `issue_references` count >= 5 — **6**
- [x] 12. procurement tag refs > 0 — **152** (see note: `type` is on `tags`, not
       `tags_refs`, so the probe joins `tags_refs → tags` and filters
       `tags.type='procurement'`)
- [x] 13. seed summary log prints contact-cats / global-proc-cats / issue-refs —
       prints `contact cats: 5`, `global proc cats: 6`, `issue refs: 6`

## Status notes

- 2026-06-04: Implementation complete. `bun run seed` runs clean (exit 0, no
  ValidationError; 5 contact cats, 14 contacts, 6 global proc cats, 38 equipment,
  8 standalone projects, 64 issues, 6 issue refs, 80 procurements). All 13 DB
  probes pass (numbers above). `bun run check` EXIT 0 — lint 0 errors (6
  pre-existing react-hook warnings, unrelated), typecheck api+web clean, api 1476
  pass / 0 fail, routes 378 pass / 0 fail, web 701 pass / 0 fail, build + i18n +
  env-docs + api-docs all green.
- Schema note (criterion 12): the shared-tags refactor moved `type` from
  `tags_refs` to the `tags` table, so `tags_refs` no longer has a `type` column.
  The literal acceptance SQL (`SELECT count(*) FROM tags_refs WHERE
  type='procurement'`) cannot run as-written on the current schema; the probe was
  adapted to join `tags_refs` to `tags` — same intent, returns 152.
