# FEAT-005 — Drive sharing on policy tuples (direct, inheritance, ownership sync)

- **Status:** Planned
- **Plan:** [PLAN-005](../plan/PLAN-005.md)
- **Created:** 2026-05-23
- **Owner:** (unclaimed)

## Scope

Resolve drive permissions through the Zanzibar engine (like documents):
- Drive `direct` grants become `relation_tuples` (viewer/editor).
- New `drive_entry` namespace with `parent_entry` subtree inheritance.
- Ownership synchronized as tuples (owner + parent_entry maintained in lockstep
  on create/move/restore/delete), plus a backfill for existing entries.
- `share` module reduced to public links only.

Open decisions in the plan: team-directory/project ownership depth (default
keep bespoke); backfill delivery. Awaiting `proceed`.

## Verification

- `bun run check` clean (lint + typecheck + tests + build + i18n + api-docs).
- Drive internal share writes/reads tuples; a grant on a folder is inherited
  by descendants; revoke removes inherited access; grants/revokes emit audit.
- Existing entries remain accessible to owners after the switch (backfill
  verified: owner-tuple count matches user-owned entry count).
- `shares` table holds only public links (no `share_type` /
  `shared_with_user_id`).
