# PLAN-044 — Project module audit remediation (A–H)

- Status: Implementing
- Campaign: l1-75ymcfnr-projaudit-20260601230043
- Date: 2026-06-01
- Source audit: [`docs/audit/project-module-audit.md`](../audit/project-module-audit.md)
  (66 findings: P0 0 · P1 7 · P2 20 · P3 39 across 7 lanes)
- Dev phase: breaking changes allowed (no backward-compat shims, no data
  migration for existing rows, DB may be reset freely).

## Goal

Eliminate the 66 findings from the consolidated project-module audit, organized
into eight fix-campaigns (A–H per the audit doc §4). Each campaign is one PMA
FIX task; every implementation unit is a separate BKD L3 issue merged into the
L2 branch `bkd/uvgvhcm1`.

## Tasks

| Campaign | Task | Theme |
| --- | --- | --- |
| A | [FIX-008](../task/FIX-008.md) | Role / authz hardening (backend) |
| B | [FIX-009](../task/FIX-009.md) | Issue-list / project-list performance (backend + web) |
| C | [FIX-010](../task/FIX-010.md) | Data-integrity / transaction correctness (backend) |
| D | [FIX-011](../task/FIX-011.md) | Detail-drawer accessibility (web) — re-audit first |
| E | [FIX-012](../task/FIX-012.md) | A11y / button-standard sweep (web) — re-audit first |
| F | [FIX-013](../task/FIX-013.md) | List-search correctness + UX polish (web) |
| G | [FIX-014](../task/FIX-014.md) | i18n parity + CI guard (web) |
| H | [FIX-015](../task/FIX-015.md) | Dead code + test gaps (full-stack) |

## DAG / ordering (file-overlap aware)

```
A ──► C ──► B ──► F ──┐
                      ├──► H
D ──────────► E ──────┘
G (independent)
```

- A, C, B all touch `project.service.ts` / `project.roles.ts` → serialize
  A → C → B.
- B and F both touch `-project-issues-tab.tsx` → B before F.
- D before E (both touch the detail panels / drawers).
- G is independent (locales + i18n.ts).
- H is last (subsumes 01-F2 dead code; coordinates 07-F1/07-F5 tag-registry;
  touches `tag.service.ts` after B and the issues-tab comments after F/E).

## Decisions to record

C-campaign L3 must add `docs/decisions/008-*.md` capturing the chosen
soft-delete cascade (04-F2) and hard-delete `tags_refs` cascade contract
(04-F3) semantics, with a dev-phase / sunset note. This is the only
design-decision doc required by the campaign.

## Truly-fixed gate

- Each L3 self-verifies `bun run check` EXIT=0 (the `@milkdown/ctx`
  `removeEventListener` teardown is a known flake — grep to confirm before
  treating a test exit 1 as real; web tests pass 544/544 normally) plus
  targeted per-finding evidence.
- L2 re-verifies the L3 report + check pass via logs, merges `--no-ff` into
  `bkd/uvgvhcm1`, re-runs `bun run check` after the merge, then marks the FIX
  task Completed.
- D/E/F suspected-already-fixed findings: the task file must cite current
  `file:line` evidence proving each is resolved (or fix the residual). No blind
  "assumed done".

## Success criteria

1. All 66 findings resolved or, for already-fixed ones, documented with current
   `file:line` evidence.
2. `bun run check` green on `bkd/uvgvhcm1` after every merge.
3. Soft/hard-delete cascade semantics recorded in `docs/decisions/008-*.md`.
4. en/zh parity guard wired into `bun run check` (06-F4).
