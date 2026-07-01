# PLAN-100 - Audit remediation (2026-07-01 deep audit)

- Status: Completed
- Tasks: [FIX-048](../task/FIX-048.md), [FIX-049](../task/FIX-049.md), [FIX-050](../task/FIX-050.md), [FIX-051](../task/FIX-051.md), [FIX-052](../task/FIX-052.md)
- Campaign: `l1-bithk-audit-20260701145456` (BKD three-tier L1/L2/L3)
- Created: 2026-07-01
- Source: [../audit/AUDIT-20260701.md](../audit/AUDIT-20260701.md)

## Context

The 2026-07-01 deep audit (see AUDIT-20260701.md) surfaced 1 P1, 3 P2, and a band of P3 items on the
current `main` (@`99ca196`). No P0. This plan remediates the actionable findings. Each FIX task maps to one
L3 subtask under the BKD L2 dispatcher; the L2 runs in worktree `bkd/{L2_ID}` and L1 merges to main after
review + user confirmation.

## Scope

In:
- FIX-048 (P1): drive `confirmDriveUpload` uploader-scoped dedup + hash-trust hardening
- FIX-049 (P2): auth IP rate-limit loopback exemption under `TRUST_PROXY=false`
- FIX-050 (P2): S3 orphan sweep continuation-token pagination
- FIX-051 (P2): pin GitHub Actions to commit SHAs (release.yml + ci.yml third-party actions)
- FIX-052 (P3 bundle): service-token constant-time; stop backup-staging sweep on shutdown; file-GC
  re-entrancy guard; client redirect scheme checks (denied/totp-verify); remove dead `DB_ENCRYPTION` env

Out (deferred / needs decision, not in this plan):
- `requireTotp` step-up path: product decision (wire vs remove) — escalate, do not auto-decide
- docker-compose root user: documented local-only choice — leave as-is
- Coverage-gap #1 (project/issue/ship/hr/procurement row-level ownership audit): separate follow-up
  audit campaign, not a fix
- `apps/web` CI coverage gate: separate CHORE if desired

## Acceptance Criteria

- Each FIX task's own acceptance criteria met.
- `bun run check` passes on the merged branch.
- No behavior change outside the stated scope of each fix.
- The P1 fix ships with a regression test proving a second user cannot attach/download another user's blob
  by sha256 via the confirm path.

## Status Notes

- 2026-07-01: Plan created from AUDIT-20260701. Remediation dispatched via BKD three-tier campaign
  `l1-bithk-audit-20260701145456`.
