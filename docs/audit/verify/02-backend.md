# V2 — Backend remediation verification (FIX-AUDIT-003..020, excl. 005)

**Campaign:** `l1-w6c655lo-verify-20260603031707` · Verifier V2 · branch `bkd/vg66r7ey`
**Base:** main @ `146d991` (the tree under verification) · **Mode:** read-only, adversarial
**Scope:** backend items FIX-AUDIT-003, -004, -006, -007, -008, -009, -010, -011, -012, -013, -014, -015, -016, -017, -018, -019, -020.
FIX-AUDIT-005 is owned by V6 and is NOT covered here.

Method for every item: opened the cited `file:line` on the current tree, confirmed the
remediation Action was applied AND that it removes the root cause (not a bypassable
surface change), grepped the tree for wiring/call-sites, and checked for regressions.

---

## FIX-AUDIT-003 — Contact list `q` probes masked PII
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `apps/api/src/modules/contact/contact.service.ts:191-216`. The non-admin
  `q` branch now matches the always-visible `name` unconditionally, but the confidential
  fields (`contactPerson`/`note`) are matched only on rows the actor can actually see —
  `or(eq(ownerId), not(and(visibility='public', confidential=true)), inArray(explicitIds))`
  (lines 208-214). This mirrors `canSeeConfidentialFields` (`contact.permission.ts:69-77`:
  owner/admin/explicit-viewer, else `!(public && confidential)`), so the search hit/miss
  oracle that previously leaked masked values char-by-char is closed. Admin path keeps the
  full match (line 198-200).
- **Method:** read list() SQL + cross-checked the masking predicate it claims to mirror.
- **Note:** masking on the response side is also applied via `composeWithCapabilities`
  (line 244); the SQL gate and the field masking are consistent.

## FIX-AUDIT-004 — Supplier IDOR / existence leak in procurement
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `apps/api/src/modules/procurement/procurement.service.ts:62-73`
  (`assertSupplierExists`) now resolves a supplier only when `contacts.confidential = false`;
  a confidential id yields the SAME "Unknown supplier" `ValidationError` as a non-existent
  one — no oracle. Wired into both write paths: create at line 185-186, update at 291-292.
- **Method:** read the accessor + grepped its call-sites (`grep assertSupplierExists`).
- **Note:** Action's option B taken ("restrict suppliers to non-confidential contacts").
  Non-confidential-but-private contacts still resolve by design (documented at lines 59-60),
  which is consistent with the Action wording.

## FIX-AUDIT-006 — Drop response/stderr bodies from cron logs
- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - http-request: `cron/actions/http-request/executor.ts:284-302`. On unexpected status the
    thrown error is `"${method} ${url} → ${status} (expected …, ${ms}ms)"` — status+duration
    only, body explicitly NOT persisted (comment 289-292). The old `await res.text()` preview
    block is gone (grep for `.text()` finds only `resolveTarget`, line 231; body is merely
    `cancel()`-ed at 277). Success return (line 302) carries no body.
  - shell: `cron/actions/shell/executor.ts:95-103`. On non-zero exit the thrown (persisted)
    error is generic `"shell command exited ${code} (${ms}ms)"`; `stderr` goes only to
    `ctx.logger.warn` (line 100) — the sanctioned "stderr already goes to the process logger"
    action (backend.md:384).
- **Method:** traced thrown Error → `cron_job_logs.error`/trigger response; grepped body reads.
- **Note:** the shell SUCCESS path still appends bounded `stdout` to its return string
  (line 110-113). This was not part of the finding (backend.md:382-385 scopes the issue to
  the non-zero-exit error), and admin-configured stdout is the action's intended output, so
  it does not affect the verdict.

## FIX-AUDIT-007 — `soft-delete-cleanup` NaN → purge-everything
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `cron/actions/soft-delete-cleanup/executor.ts:25-31`. `olderThanDays` is
  parsed and `if (!Number.isFinite(olderThanDays) || olderThanDays < 0) throw new
  ValidationError(...)` — a NaN/negative no longer silently nulls the cutoff and purges all
  tombstones. The documented `default 0 = purge immediately` is preserved deliberately
  (line 19-24, 32-34).
- **Method:** read the parse → guard → cutoff → delete path.

## FIX-AUDIT-008 — `export-via-token` full DB exfiltration
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `backup/export.routes.ts:104-250`. Three hardenings, all present:
  (1) module scope is mandatory and FAILS CLOSED — a missing/empty/non-JSON body is rejected
  403 `SCOPE_REQUIRED` (lines 112-138), unknown modules 400 (141-144); no implicit
  "export everything".
  (2) secret-typed fields are redacted chunk-by-chunk during streaming
  (`SECRET_FIELD_NAMES` 39-47, `redactSecretFields`/`redactBackupChunk` 50-83, applied at 226).
  (3) blast radius documented (comment 91-103), with the per-token-scope binding explicitly
  flagged as out-of-lane REMAINING (101-103).
- **Method:** read the route end-to-end + the redaction helpers.
- **Note:** the success audit row is `{ critical: true }` (line 209) — ties into FIX-AUDIT-009.

## FIX-AUDIT-009 — `audit()` swallows insert errors
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `audit/audit.service.ts:29-84`. New `AuditOptions.critical`: on insert failure
  a critical event logs `error` and **re-throws** (77-79); routine events log `warn` and
  swallow (81-82). High-sensitivity callers opt in: `backup/export.routes.ts:209,297`
  (export success), `backup/restore.routes.ts:183` (`user.restored`), `:203` (`backup.import`)
  — all the destructive/exfiltrating actions named in the finding.
- **Method:** read the catch branch + `grep "critical: true"` across the tree.
- **Note:** export *rejection* audits (unscoped/in-flight/min-interval) stay best-effort,
  which is correct — nothing destructive happened on those paths.

## FIX-AUDIT-010 — `drive_entry` ACL hook denies team/project/share
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `drive/drive.file-permission.ts:30-44`. Both `canRead` and `canDelete` now
  delegate to `resolveEntryCapabilities` and check `caps.has("read")`/`caps.has("delete")`.
  `resolveEntryCapabilities` (`drive/drive.permission.ts:61-128`) honors personal owner,
  team-directory role (admin/editor/viewer), project caps (`files.manage`/`files.view`) and
  active direct shares — so the hook no longer denies legitimate team/project/share access.
- **Method:** read the hook + the capability resolver it reuses.

## FIX-AUDIT-011 — Public share routes have no rate limiting
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `share/share.public.routes.ts:47` —
  `router.use("*", rateLimit({ windowMs: 60_000, max: 120, bucket: "share-public" }))`
  applied across every public share path before the gate/list/download handlers. The limiter
  is IP-keyed: `shared/middleware/rate-limit.ts:3,100` keys on `getClientIp(c, c.var.config)`
  ("Max requests per IP per window", line 13).
- **Method:** read the router + the limiter's key derivation.

## FIX-AUDIT-012 — Non-atomic ship-cover reference release
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `ship/ship.service.ts`. All three cover-mutating paths release inside the tx
  via `releaseReferenceTx` and finalize the blob after commit via `finalizeReleasedBlob`:
  `softDeleteShip` (404-414), `setShipCover` (456-469, with rollback releasing the freshly
  uploaded ref on tx failure, 465-468), `removeShipCover` (490-497). Mirrors the project F4
  pattern as the Action requires.
- **Method:** read each cover path's transaction + post-commit finalize.

## FIX-AUDIT-013 — XFF spoofing when proxy allow-list empty
- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `shared/lib/client-ip.ts:49-51` — in `production` with an empty allow-list, forwarding
    headers are ignored and the socket peer IP is returned (fail closed). Per-peer gate at
    58-60 covers the non-empty allow-list case.
  - `config/sentinels.ts:51-85` (`assertProductionNetworkGuards`) — in production throws
    `ConfigError` when `CORS_ORIGIN` missing with OAuth (57-59) and when `APP_URL` missing
    with OAuth (60-66); warns on the spoofable `TRUST_PROXY` config (78-82).
  - Wiring: guards invoked at boot `config.ts:60,63`; the IP-keyed limiter passes config so
    the fail-closed path is live (`rate-limit.ts:100`, `auth.routes.ts:128`,
    `settings.routes.ts:98,125`).
- **Method:** read both files + grepped invocation sites.

## FIX-AUDIT-014 — CSRF origin check skipped when no allowed-origins
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `shared/middleware/csrf.ts:65-77`. When no allow-list can be built
  (neither `CORS_ORIGIN` nor `APP_URL`), production returns 403 `CSRF_REJECTED` (fail closed);
  dev logs a warning and proceeds. Missing Origin/Referer is also a rejection when a list
  exists (79-86). Guard is registered globally: `app.ts:99` `api.use("*", csrfGuard)`.
- **Method:** read the middleware + grepped its registration.

## FIX-AUDIT-015 — Suffix-based settings secret masking + unbounded value
- **Verdict:** PARTIAL
- **What landed:**
  - Max length: `settings/settings.routes.ts:27,30` — `MAX_SETTING_VALUE_LENGTH = 64*1024`
    enforced by `putSettingSchema` (`z.string().min(1).max(...)`); key bounded by
    `SETTING_KEY_RE` (≤128 chars, line 21). The unbounded-value half is fully fixed.
  - Suffix contract enforced consistently: masking applied on every read
    (`settings.service.ts:36-64`; routes list 49, single 64, audit prev/new 83-97) and the
    masked placeholder is rejected on write (routes 76-78).
- **What is missing:** the Action's first sub-action — "move secrets out of the generic
  settings table (env)" — was NOT done. `settings.service.ts:17-20` explicitly defers it
  ("Genuinely secret settings should move to env or encrypted storage … that migration is
  the larger follow-up"). So the root weakness named in the finding title ("suffix-based
  masking") persists: a secret stored under a key that does not end in a known sensitive
  suffix (e.g. `oauth.clientSecretValue`) is still returned in plaintext by `GET /settings`.
  No `docs/decisions/*` entry sanctions this deferral (checked the 11 decision files), so it
  is an incomplete fix rather than an honored decision.
- **Method:** read service + routes; grepped `docs/decisions/` for a settings/secret decision.

## FIX-AUDIT-016 — Missing input bounds at handler edges (cluster)
- **Verdict:** VERIFIED-FIXED
- **Evidence (all five cited edges bounded):**
  - `ship.routes.ts` — `listSchema` `q.max(200)` + `status` enum + `tagId.max(100)` (80-84);
    tag array bounded `z.array(z.string().min(1).max(50)).max(50)` (46); `parsePageQuery` (157).
  - `procurement.routes.ts` — `listQuerySchema` `q.max(200)` + status/priority enums +
    `categoryId.max(100)` (71-76); `parseTagIds` capped to 50 (81-93); `parsePageQuery` (164).
  - `issue.routes.ts` — `listQuerySchema` `q.max(200)` + status/priority enums (69-73);
    `parseTagIds` capped to 50 (85-97); `parsePageQuery` (161).
  - `account/users/users.routes.ts` — preference key `≤200` (100,105) and value `≤64 KiB`
    via TextEncoder byte check → 413 (99,119-120); strict body shape (89-93,114-117).
  - `cron.routes.ts` — list `limit` `int().min(1).max(200)` + bounded cursor (63-65, also logs
    84-85); create schema bounds name/cron/action + `config` key length + byte-size limit
    (31-49). Cursor pagination (bounded limit) is the appropriate analog to `parsePageQuery`.
- **Method:** read each list/create schema + its handler usage.

## FIX-AUDIT-017 — Non-atomic two-step writes (cluster)
- **Verdict:** VERIFIED-FIXED
- **Evidence (all three wrapped in a single transaction):**
  - delete-then-create: `policy/policy.service.ts:159-163` (`updateTupleRelation`) — delete +
    `checkDuplicateTuple` + insert inside `db.transaction`; called from `policy.routes.ts:165`.
  - release-then-delete: `item/comment.service.ts:184-188` (`deleteComment`) — `releaseReferenceTx`
    for each attachment + comment row delete in one tx; blobs finalized after commit (190-192).
  - check-then-insert: `policy/policy.service.ts:486-515` (`addGroupMembership`, the impl behind
    `groups.routes.ts:182` → `addGroupMember`) — existence check + insert inside `db.transaction`
    so concurrent double-adds serialize (NULL `subjectRelation` rows the unique index can't cover).
- **Method:** followed each route to the service fn and confirmed the tx boundary.

## FIX-AUDIT-018 — `composeIssue` non-null assertion → 500
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `issue/issue.service.ts:160-162` — `const d = details ?? (await … get()); if (!d)
  throw new NotFoundError("Issue details", item.shortId);` replaces the old `!` assertion. The
  update path also guards: `:306-308`. `composeIssueRow` only receives a guaranteed row (after
  the guard, or from the list/search `innerJoin` at 456/468/527).
- **Method:** read composeIssue + update + the list/search join callers.

## FIX-AUDIT-019 — Raw `Error` → 500 instead of 404 (document/drive)
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `document/document.service.ts` — the three cited sites now throw
  `NotFoundError` (126 parent, 238 parent, 711 document); `grep "throw new Error"` returns
  nothing in either service. `drive/drive.service.ts:744-752` (`throwDuplicateName`) matches the
  SPECIFIC index: requires both `"UNIQUE constraint failed"` AND `"drive_entries.name"` (747),
  walks the `err.cause` chain, and lets violations on other indexes fall through to rethrow the
  real error — no over-broad "any UNIQUE = name clash". Used by all drive create/move/rename
  paths (301,354,415,455,492).
- **Method:** grepped raw errors + read `throwDuplicateName` + its call-sites.

## FIX-AUDIT-020 — Direct-share capability ignores expiry/exhaustion
- **Verdict:** VERIFIED-FIXED
- **Evidence:** `drive/drive.permission.ts:100-136`. The direct-share query now selects
  `expiresAt`, `maxDownloads`, `downloadCount` (103-105) and the grant is conferred only when
  `share && !isShareExpired(share) && !isShareExhausted(share)` (120) — `isShareExpired`
  (130-132: `expiresAt !== null && < now`) and `isShareExhausted` (134-136:
  `maxDownloads !== null && downloadCount >= maxDownloads`). An expired/exhausted direct share
  no longer grants access through the authenticated drive routes.
- **Method:** read the share query + the two predicate helpers.

---

## Summary

17 items verified (FIX-AUDIT-005 excluded — owned by V6).

- **VERIFIED-FIXED (16):** FIX-AUDIT-003, -004, -006, -007, -008, -009, -010, -011, -012,
  -013, -014, -016, -017, -018, -019, -020.
- **PARTIAL (1):** FIX-AUDIT-015 — value max-length bound and consistent suffix-masking
  enforcement landed, but the recommended "move secrets out of the generic settings table
  (env)" was deferred (documented in-code as REMAINING, no sanctioning decision doc), so the
  bypassable suffix-heuristic for arbitrarily-named secret keys persists.

**Non-VERIFIED items:** FIX-AUDIT-015 (PARTIAL).

`git diff --name-only`: `docs/audit/verify/02-backend.md`
