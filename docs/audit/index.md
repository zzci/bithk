# BITHK Project Audit — Index

> **Follow-up audits:**
> - [AUDIT-20260702-architecture.md](./AUDIT-20260702-architecture.md) — 2026-07-02 whole-system architecture assessment @ `49157032`. No P0/P1 security; 1 HIGH drift (route-table omits `/admin/storage/*` from docs+spec), 1 HIGH test gap (policy middleware untested + fail-open branch), registry proliferation, boilerplate duplication, gate waste. Remediation: [../plan/PLAN-104.md](../plan/PLAN-104.md) (REFACTOR-030…035, FIX-054…057, UI-028/029, TEST-001), BKD campaign `l1-bithk-arch-20260702084717`.
> - [AUDIT-20260701.md](./AUDIT-20260701.md) — 2026-07-01 deep audit @ `99ca196`. 0 P0, 1 P1 (drive confirm-upload IDOR), 3 P2, 6 P3. Remediation: [../plan/PLAN-100.md](../plan/PLAN-100.md) (FIX-048…052), BKD campaign `l1-bithk-audit-20260701145456`.

**Campaign:** `l1-w6c655lo-audit-20260602135842` · **Mode:** AUDIT-ONLY (no source code, dependency, config, or schema was changed — only audit reports were authored).

**Scope:** the full BITHK monorepo — `apps/api` (Bun/Hono backend), `apps/web` (React + Vite SPA), `packages/*` (shared/tsconfig), `scripts/`, `tests/`, and root configuration (`package.json`, `tsconfig*`, `bunfig.toml`, `eslint.config.ts`, CI workflow). Seven independent dimension audits were run by parallel L3 agents; this document aggregates their results. Every finding carries a `file:line`, a severity, a confidence, and a method. Remediation is explicitly out of scope here and is deferred to a separately-approved follow-up campaign (see `./remediation-backlog.md`).

---

## Summary by dimension

Counts below are **derived from each report body** (per-bullet enumeration for the five narrative reports; the report's own totals table for the two bulk/tabular reports `dead-code-web` and `dead-code-deps`). Where a report body diverges from its own headline "Totals by severity" table, the body count is used and the divergence is recorded under *Count reconciliation*.

| Dimension | Report | Total | Critical | High | Medium | Low |
|-----------|--------|------:|---------:|-----:|-------:|----:|
| Dead code — API | [./dead-code-api.md](./dead-code-api.md) | 19 | 0 | 0 | 2 | 17 |
| Dead code — Web | [./dead-code-web.md](./dead-code-web.md) | 157 | 0 | 0 | 4 | 153 |
| Dead code — Deps/data | [./dead-code-deps.md](./dead-code-deps.md) | 5 | 0 | 0 | 1 | 4 |
| Backend correctness | [./backend.md](./backend.md) | 100 | 0 | 2 | 40 | 58 |
| Frontend correctness | [./frontend.md](./frontend.md) | 46 | 0 | 0 | 19 | 27 |
| Architecture & types | [./architecture.md](./architecture.md) | 11 | 0 | 1 | 5 | 5 |
| Testing posture | [./testing.md](./testing.md) | 14 | 0 | 0 | 4 | 10 |
| **TOTAL** | — | **352** | **0** | **3** | **75** | **274** |

> **No critical findings** in any dimension. The dominant severity is `low` (78% of findings), driven by the large dead-code surface (109 dead i18n keys, redundant `export` modifiers) and a long tail of backend hardening/consistency items. The actionable risk is concentrated in the **3 High** findings and a band of security-relevant **Mediums** (see *Top risks*).

### Count reconciliation (body vs. each report's headline table)

The grand total and per-dimension counts above are internally consistent (`0 + 3 + 75 + 274 = 352`). Four reports' headline "Totals by severity" tables differ slightly from their own enumerated bodies; the body is authoritative:

- **architecture.md** — headline table says **2 high / 4 low**; the body documents exactly **1 high** (Area B, the API-envelope fragmentation) and **5 low**. Dimension total is unchanged (11), but only **one** architecture High is substantiated by the body. → counted as `1 high / 5 low`.
- **frontend.md** — headline table says **24 low** (total 43); the body enumerates **27 low** findings (total 46). → counted as `27 low`.
- **dead-code-api.md** — headline table says **16 low** (total 18); the body enumerates **17 low** (total 19). → counted as `17 low`.
- **testing.md** — headline table says **9 low** (total 13); the body enumerates **10 low** findings (A1–E1 = 14 numbered, total 14). → counted as `10 low`.
- **backend.md** (100), **dead-code-web.md** (157), **dead-code-deps.md** (5) — body matches headline; no reconciliation needed. (`dead-code-web`'s 153 low is bulk: `toc-scanner.test.ts` + `STORAGE_KEY` (2) + 1 re-export + 1 test type + 13 value exports + 27 type exports + **109 dead i18n keys** = 153; `dead-code-deps` is a 5-row table: DEP-1 medium, DEP-2/3 + ENV-1/2 low.)

> Consequently the campaign surfaces **3 High findings, not 4** — the "2 backend + 2 architecture" expectation reduces to **2 backend + 1 architecture** once the architecture body is taken as authoritative.

---

## Top risks

### High-severity (3) — highest priority

1. **SSRF via redirect-following in the cron `http-request` action** — `apps/api/src/modules/cron/actions/http-request/executor.ts:191-194,224` (backend, high/high). `RequestInit` sets no `redirect`, so `fetch` follows by default; the DNS-pin + `isPrivateDestination` private-range guard vets only the **first** hop. A vetted public URL that 30x-redirects to `http://169.254.169.254/…` (cloud metadata) or an internal host is then fetched unvalidated — a full bypass of the private-IP guard.
2. **Silent per-table data loss in backup restore** — `apps/api/src/modules/backup/restore.service.ts:334-342` (backend, high/high). The restore transaction unconditionally `delete`s every table in `deleteOrder` (driven by the uploaded `modules`) but only inserts tables present & non-empty in `data.tables`. A truncated/partial/hand-edited backup that lists a module but omits one of its table keys **silently wipes that live table with nothing restored** — destructive, input-driven.
3. **API response-envelope type fragmentation** — `apps/web/src/shared/lib/api/projects.ts:17` (+13 sibling files) (architecture, high/high). 14 copy-pasted inline `ApiEnvelope<T>`/`ApiListEnvelope<T>` definitions, all using a weak non-discriminated `success: boolean` so TS cannot narrow `data` vs `error`. The single largest cross-cutting type-safety issue in `web`; a shape change touches 14 files. *(Note: architecture.md's headline table claims a 2nd high, but the body documents only this one — see Count reconciliation.)*

### Notable mediums worth surfacing (security/correctness-relevant)

Backend (the 40 mediums cluster around PII, secrets-at-rest, log leakage, atomicity, and missing input bounds):

- **Masked-contact PII probing via list search** — `apps/api/src/modules/contact/contact.service.ts:188-190` (high). The list `q` matches `contactPerson`/`note`, which are masked for non-privileged actors, allowing character-by-character substring probing of hidden fields via search hit/miss.
- **Supplier IDOR / existence leak** — `apps/api/src/modules/procurement/procurement.service.ts:51-60` (high). A supplier is validated for existence only (no access check), so a PM can attach a confidential contact they cannot see and its id is returned on every procurement row.
- **Cron job secrets stored plaintext & echoed** — `apps/api/src/modules/cron/cron.routes.ts:175,204` + `serialize.ts:57-64` (high). `task_config` (incl. Bearer headers / `secret` inputs) is persisted unencrypted and returned verbatim by GET.
- **Target response / stderr bodies leaked into logs** — `http-request/executor.ts:250-252`, `shell/executor.ts:100` (high). Up to 2–4 KB of target body/stderr lands in `cron_job_logs.error` and the trigger response.
- **`soft-delete-cleanup` NaN → purge-everything** — `apps/api/src/modules/cron/actions/soft-delete-cleanup/executor.ts:48` (high). `Number(bad)` → `NaN`, `cutoffIso` stays null, all soft-deleted jobs hard-deleted regardless of grace window.
- **`backup/export-via-token` = full plaintext DB exfiltration** — `apps/api/src/modules/backup/export.routes.ts:37` (high). A single static bearer streams the entire unlocked DB (users, audit, cron secrets), bypassing the session/DEK challenge.
- **`audit()` swallows insert errors** — `apps/api/src/modules/audit/audit.service.ts:28` (high). Destructive actions can complete with no audit trail.
- **`drive_entry` file-permission hook denies team/project/share access** — `apps/api/src/modules/drive/drive.file-permission.ts:5-34` (high). Owner-only check 404s legitimate team/project members through `GET /files/:id/content`; fail-closed functional bug, inconsistent with `resolveEntryCapabilities`.
- **Public share routes have no rate limiting** — `apps/api/src/modules/share/share.public.routes.ts` (high). Password-protected tokens are brute-forceable at network speed (no module-local or global limiter).
- **Non-atomic ship-cover reference release** — `apps/api/src/modules/ship/ship.service.ts:445-487,395-412` (high). Cover repoint/clear + `releaseReference` are separate statements; a crash leaks the previous file reference (project module already fixed this via `releaseReferenceTx`).
- **XFF spoofing defeats IP-keyed limiters/audit** — `apps/api/src/shared/lib/client-ip.ts:42-45` + `config/sentinels.ts:64` (high/high). `TRUST_PROXY=true` with an empty `TRUSTED_PROXY_IPS` honors forged `X-Forwarded-For` from any direct peer.
- **Suffix-based settings secret masking + unbounded value** — `apps/api/src/modules/settings/settings.service.ts:15`, `settings.routes.ts:24` (high). Secrets under non-suffixed keys returned plaintext; settings value has no size cap.

Cross-cutting (architecture / frontend / testing):

- **~200 non-null `!` assertions in route handlers** rooted in `apps/api/src/shared/lib/types.ts:17` (`user?: User` optional) — architecture C (medium/high).
- **`as unknown as RunResult` Drizzle double-cast duplicated across ~11 service files** — architecture D (medium/high).
- **No app-wide error boundary / `errorComponent`** — `apps/web/src/app/__root.tsx:12`, `app/providers.tsx:12` (frontend, medium/high); query errors silently render as empty-state in several views (frontend D.2).
- **Hardcoded CJK date formatter (policy + locale bypass)** — `apps/web/src/app/routes/_app/-documents-shared.ts:16` (frontend, medium/high).
- **`bun run check` excludes e2e and the route HTTP layer** — `package.json:35` + `apps/api/bunfig.toml` (testing A1, medium/high): a green local gate proves nothing about HTTP handlers.

---

## Method coverage

| Dimension | Primary tools / skills | Notes |
|-----------|------------------------|-------|
| Dead code — API | `ts-prune`, `knip` (ephemeral), `ripgrep` cross-verify | knip ran **degraded** (could not resolve `@/*` alias / `drizzle.config.ts`); its "unused files/exports" lists were treated as candidate hints only and re-verified by grep. |
| Dead code — Web | `knip`, `ts-prune`, custom i18n key-usage script, `ripgrep` | i18n: 1423 `en` leaf keys flattened, matched with bounded-literal + dynamic-prefix + plural-aware regex; every key cross-grepped. |
| Dead code — Deps/data | `knip` (lead generator only), `ripgrep` per-dep/table/column/env | knip's dep output unreliable (un-parsed `vite.config.ts`, 1817 false "unresolved imports"); every verdict re-derived by grep. Lockfile mutation reverted via `git checkout`. |
| Backend correctness | `pma-cr` (TS backend/Bun), `audit-context-building`, manual re-read | Line-by-line per-module read; every High + top Mediums re-verified against cited source. |
| Frontend correctness | `pma-cr` (TS frontend), `audit-context-building`, `ripgrep` | Mechanical scans (native `<button>`, CJK, `role="button"`, `console.*`) + targeted deep reads; candidate findings dropped after verification (e.g. the native-button set is keyboard-accessible). |
| Architecture & types | `madge --circular` (with `--ts-config`), `ripgrep` (`any`/`as`/`!`), `context7`, manual config read | Both apps: **zero cycles**; `any` genuinely banned (0 in prod); strict tsconfig baseline verified. |
| Testing posture | test-vs-source import-graph (`find`+`ripgrep`), coverage-config & CI review, brittleness scan | API unit ≈83% line / ≥80 gated; web floor 29% lines / 24% branches. |

### Known pre-existing exclusions (from testing.md — NOT counted as new findings)

- **Web branch-coverage floor** — `apps/web/vitest.config.ts` now enforces lines/stmts/funcs ≥29, branches ≥24; the older "~3.99% under a 4% floor" note is stale (floor was raised).
- **`-project-issue-panel.test.tsx` `@milkdown/ctx` teardown race** is known-flaky (re-run or run filtered).
- **Forward-apply / per-migration data-preservation** is untested by policy (dev-phase: DB reset freely) — accepted.

---

_This index and `./remediation-backlog.md` are the only files added by the aggregation step; the seven dimension reports are unchanged._
