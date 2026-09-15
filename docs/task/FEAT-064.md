# FEAT-064 Per-actor write rate limit on mutating API routes

- **status**: completed
- **priority**: P1
- **owner**: session-20260915-write-rate-limit
- **createdAt**: 2026-09-15

## Description

Every mutating protected route is currently unthrottled. A misbehaving client —
a runaway script, a retry loop, an integration using a Personal Access Token —
can create records (and the audit rows every write emits) as fast as the process
answers. Only `auth`, `totp-stepup` and `share-public` carry a limiter today, all
per-IP; the authenticated write surface (184 mutating routes, uploads included)
has none.

Cap mutating requests per actor at a rate a human — including a human running a
bulk upload — never reaches, so a looping client is throttled instead of
flooding the database. See [PLAN-118](../plan/PLAN-118.md).

## Acceptance

- Mutating requests (`POST` / `PUT` / `PATCH` / `DELETE`) on protected API routes
  are counted per actor and answered `429 RATE_LIMITED` with `Retry-After` once
  the budget is spent.
- Reads (`GET` / `HEAD` / `OPTIONS`) are unaffected.
- The budget is keyed by user id, so one actor cannot spend another's budget and
  a shared NAT egress IP is not a shared bucket.
- The limit is env-tunable and can be switched off for test harnesses.
- A bulk drive folder upload of a few hundred small files still completes.
- `bun run check` and `bun run test:e2e` pass.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Shipped as three per-actor buckets rather than one: `create` (30/min + 300/h),
`write` (60/min), `write-bulk` (600/min). A flat 20/min on all writes was
rejected during review — the issue panel patches one field per request, so
triaging four work orders is ~24 writes a minute.

- complete: bun run check and test:e2e (109/109) passed; limiter verified on the real protected router.
