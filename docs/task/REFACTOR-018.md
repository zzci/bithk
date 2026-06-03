# REFACTOR-018 Drive-style multi-dropdown unified ListFilter + full adoption

- **plan**: [PLAN-055](../plan/PLAN-055.md)
- **status**: Done
- **owner**: direct (PMA)
- **createdAt**: 2026-06-03
- **completedAt**: 2026-06-03

## Summary

Rewrite shared `ListFilter` into a Google-Drive-style bar of independent
per-dimension dropdowns (selected single → highlighted trigger + connected ×;
selected multi → per-value removable chips; trailing Clear-filters). Adopted
everywhere and deleted the duplicate filter components. Closes audit P4.

## Checklist

- [x] Rewrite `shared/components/list-filter.tsx` (remove residency; per-dimension
      dropdowns; single trigger+× ; multi trigger + per-value chips; clear-all;
      `FilterOption.icon`).
- [x] Rewrite `shared/components/list-filter.test.tsx`.
- [x] Migrate 9 call sites — drop `resident`/`residentCount`:
      projects/ships/contacts lists, admin users/cron/audit/policies-tuples,
      project issues + procurement tabs.
- [x] Drive: `-drive-file-list-filter-bar.tsx` rewritten as a thin adapter that
      builds dimensions and renders `ListFilter` (file + share surfaces, incl.
      `extraFilters`); the hand-rolled dropdown logic is gone.
- [x] Fold procurement tags into its `ListFilter` (multi dimension); delete
      `-project-tag-filter.tsx` + `-project-tag-filter.fit.ts(.test)`.
- [x] i18n `list.clearFilters` en/zh.
- [x] `bun run check` green (REAL_EXIT=0: lint + typecheck + tests w/ coverage +
      routes + build + i18n + env + api-docs).

## Notes

- `DriveFilterBar` kept as a ~90-line adapter (maps the drive string-union
  filters → `dimensions`) rather than deleted, to keep `DriveFilterBarProps`
  stable so the surface/toolbar wiring and `-share-lists.tsx` are untouched. All
  filter rendering now flows through the single unified `ListFilter`.
- Behavioural change (intended, dev phase): status/role/result filters moved from
  always-visible inline chips to dropdowns; tag "pinned common tags" residency is
  gone. Affected feature tests updated accordingly.
- Local-only; not committed/pushed.
