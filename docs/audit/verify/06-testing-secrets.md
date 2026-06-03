# V6 Verification — Testing + Secrets-decision + §4 low spot-checks

**Campaign:** `l1-w6c655lo-verify-20260603031707` · **Verifier:** L3 V6 (`bkd/bx3fl6os`)
**Base:** `main @146d991` (worktree HEAD `146d991`) · **Mode:** VERIFICATION-ONLY (read-only on all source)
**Scope:** FIX-AUDIT-005, 027, 028, 029, 030, 031, 032 · REFACTOR-AUDIT-016, 017, 018, 019
(FIX-AUDIT-026 is owned by V5 — not verified here.)

Method legend: opened each cited `file:line` on the current tree, confirmed the remediation Action
was applied and removes the root cause, and grepped the whole tree for residual/regressed patterns.
Grouped/low items were **spot-checked** on a named representative subset (coverage reported per item).

---

## FIX-AUDIT-005 — Cron job secrets at rest (DECISION ITEM)

- **Verdict:** N/A-BY-DECISION (no at-rest encryption; redaction + bounds honored)
- **Evidence:**
  - Decision recorded in-code: `cron/serialize.ts:126-129` — "at-rest encryption … is INTENTIONALLY
    NOT implemented (per project decision, FIX-AUDIT-005). The chosen mitigation is response redaction
    here in `serializeJob` plus the task-config payload/size bounds enforced in `cron.routes.ts`;
    plaintext at rest is accepted." Authored by commit `160beb7` ("docs(cron): record at-rest
    encryption decision for cron secrets (FIX-AUDIT-005)").
  - **Redaction present:** `cron/serialize.ts:49-62` `redactSecrets()` recursively masks both
    declared `secret`-typed inputs (`secretKeysFor`, `:64-70`) **and** a name deny-list
    (`SENSITIVE_KEY_NAMES`, `:19-38`: authorization/cookie/token/secret/password/api_key/… ) at every
    nesting depth (`REDACT_MAX_DEPTH=8`). Corrupt JSON → `{ _raw: "[REDACTED]" }` (`:135-139`), so a
    secret substring in a malformed blob is not echoed either.
  - **GET/response paths redacted:** `serializeJob` is the sole DTO builder; it is the response path for
    `GET /cron/jobs` (`cron.routes.ts:179`), `POST /cron/jobs` create (`:251`). The manual-trigger
    handler parses `taskConfig` only to *execute* it (`:358`) and returns log status/duration only
    (`:401-410`) — config is never reflected.
  - **Value bounds present:** `cron.routes.ts:27-29,35-42` — `MAX_CONFIG_KEYS=50`,
    `MAX_CONFIG_KEY_LENGTH=100`, `MAX_CONFIG_BYTES=16*1024`, enforced via zod `.record(...).refine()`
    on `createJobSchema.config`.
- **Method:** read `serialize.ts` end-to-end; traced every `serializeJob` caller in `cron.routes.ts`;
  `git show 160beb7`.
- **Note:** The decision is documented in the code comment + commit message, **not** as a
  `docs/decisions/NNN-*.md` entry (the only cron/secret hits under `docs/decisions/` are unrelated —
  008 cascade, 009 barrels). The substance — a deliberate, recorded no-encryption decision with the
  accepted mitigation in place — is honored, so the verdict stands; a `docs/decisions/` entry would
  make the decision more discoverable.

## FIX-AUDIT-027 — Raise web coverage floor; test pure logic

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - Floor ratcheted: `apps/web/vitest.config.ts` thresholds now `lines/statements/functions: 38`,
    `branches: 33` (comment notes measured coverage ~42.2/42.7/36.5). This is up from the
    testing.md-recorded 29/24 baseline — an incremental ratchet as the Action prescribed.
  - All four prioritized pure-logic tests exist: `apps/web/src/shared/lib/tag-utils.test.ts`,
    `status-colors.test.ts`, `errors.test.ts`, and `apps/web/src/shared/hooks/use-debounce.test.ts`.
- **Method:** read thresholds block; `find` for each named test file.
- **Note:** D1 also listed `use-share.ts`/`use-attachment-upload.ts` as cheap wins; the Action only
  required the four above (all present). Floor < measured coverage, so the ratchet is real, not a no-op.

## FIX-AUDIT-028 — Integration tests for `/files` + drive ACL hook

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `apps/api/src/modules/file/file.routes.test.ts` covers `GET /files/:id/metadata` (401 no session,
    owner success, **non-owner → 404**, **missing `ref` → 404**, wrong-file ref → 404; `:72-107`) and
    `GET /files/:id/content` (401, **owner attachment-disposition**, **`?inline=true` → inline**,
    non-owner 404, missing ref 404; `:111-148`).
  - `apps/api/src/modules/drive/drive.file-permission.test.ts` asserts `canRead`/`canDelete` for
    owner (true/true), stranger (false/false — "was the bug: owner-only check"), global admin
    (true/true), missing entry (false/false), and team-directory editor access (`:98-149`).
- **Method:** grepped both test files for case names + assertions.

## FIX-AUDIT-029 — Missing mutation `onError` feedback

- **Verdict:** VERIFIED-FIXED
- **Evidence:** all four cited mutations now carry an `onError` toast:
  - ship delete — `ships/$shipId.lazy.tsx:92` (`onError: (err) => …`).
  - contact delete — `contacts/index.lazy.tsx:356` (`toast.error(errorMessage(err, …deleteFailed))`).
  - share revoke — `-share-lists.tsx:207` (`onError` on `revoke.mutate`).
  - tuple-row delete — `admin/-policies-tuples.tsx:48` (`onError` on the inline `deleteMutation`).
- **Method:** grepped each file for `onError`/`onSuccess` on the named mutation.

## FIX-AUDIT-030 — De-flake real-clock tests

- **Verdict:** VERIFIED-FIXED
- **Evidence:** all five cited flaky patterns removed:
  - `item/comment.test.ts` — the `Bun.sleep(2)` is gone; ordering now pinned via explicit distinct
    `createdAt` stamps (`db.update(...).set({ createdAt: "2026-01-01T00:00:0{0,1}…" })`, ~`:179-180`).
  - `item/pin.routes.test.ts` — `Bun.sleep(5)` gone; explicit `pinnedAt` stamps drive `pinnedAt DESC`.
  - `shared/middleware/rate-limit.test.ts:36-53` — the `windowMs:1` + real-sleep expiry test now
    injects a fake clock (`Date.now = () => clock; clock += 1001`) with `windowMs:1000`. (A residual
    `windowMs:1` at `:79` is the GC-sweep test — not timing-fragile; it asserts the map keeps working
    after 201 keys, no expiry race.)
  - `shared/lib/logger.test.ts` and `audit/retention.test.ts` — **zero** `Bun.sleep` remain.
- **Method:** `grep -n "Bun.sleep\|windowMs"` across all five files; read the rate-limit clock-injection test.

## FIX-AUDIT-031 — Backend low-severity hardening tail (grouped, ~58 lows)

- **Verdict:** PARTIAL — bulk hardening applied; two spot-checked sub-findings remain (both rated
  negligible/optional by the original audit).
- **Spot-checked representative subset (7 of the named categories):**
  - ✅ **LIKE `%`/`_` escaping** — `escapeLike()` now defined and used in 8 services
    (`contact:100`, `item:17`, `document:33`, `issue:30`, `procurement:29`, `ship:40`, `project:57`,
    `audit:12`). Root cause (wildcard injection into LIKE) removed broadly.
  - ✅ **IPv6 proxy CIDR** — `shared/lib/client-ip.ts` now tags IP version and matches with BigInt for
    the "128-bit IPv6 case" (`:103,123,130,141`); IPv4 peers are no longer matched against IPv6 ranges.
  - ✅ **Optimistic-version guard (project)** — `project/project.service.ts:429-465` `updateProject`
    scopes the UPDATE on `expectedVersion` inside a transaction and returns a `ProjectVersionConflict`
    on `changes===0`.
  - ✅ **Audit `resourceId` consistency** — `issue/issue.routes.ts:~427` attachment-delete now audits
    `resourceId: issueShort` (matches its siblings; the cited `c.req.param("id")` inconsistency is gone).
  - ✅ **Input bounds** — `project/project.routes.ts:78` `q: z.string().min(1).max(200)` (was unbounded).
  - ❌ **Service-token length side-channel** — `shared/middleware/service-token.ts:35` still
    `if (a.length !== b.length || !timingSafeEqual(a, b))` — the length short-circuit was not removed.
    (Backend.md itself rated this "negligible given min-32 random tokens".)
  - ❌ **Procurement optimistic-version guard** — `procurement/procurement.service.ts:307,382` still
    bump `version = version + 1` with **no** `where version = ?` guard and **no** "display-only"
    documenting comment; the audit's either/or remediation was applied in neither form.
- **Method:** grep for `escapeLike`/CIDR/`timingSafeEqual`/`expectedVersion`; read `updateProject`,
  the issue attachment-delete `audit()` call, and procurement update/status-change paths.
- **Note:** Grouped low item — coverage ≈ 5/7 on the representative sample; the two residuals are the
  exact items the original audit flagged as negligible (token length) or optional/either-or
  (procurement version). No regressions observed.

## FIX-AUDIT-032 — Testing low tail (grouped)

- **Verdict:** VERIFIED-FIXED (all five named sub-items present and substantive)
- **Evidence:**
  - PKCE seal/open — `account/auth/pkce-secret.test.ts`: round-trip, versioned 4-part `v1:` format,
    fresh-IV, **tampered ciphertext → undefined**, **tampered auth-tag → undefined** (`:13-40+`).
  - `parsePageQuery` — `shared/lib/pagination.test.ts` (50 lines): defaults, valid parse+offset,
    clamp limit to [1,100], floor page to ≥1, non-numeric fallback, fractional floor.
  - route-registry bindings — `policy/route-registry.test.ts` (80 lines): register/return-all,
    filter-by-resource, defensive copy, reset, and "maps each contact route+method to its action".
  - `pagination-footer` — `apps/web/.../pagination-footer.test.tsx` (54 lines): total label + i18n,
    prev/next disabled states, callback fires/doesn't on disabled.
  - embedded-migration smoke — `apps/api/src/db/embedded-migrations.test.ts` (97 lines): empty-Map
    stub at rest, journal sentinel + per-entry `.sql`, forward-apply into a fresh DB.
- **Method:** `find` each file; grepped `it(`/`test(` names and counted lines (non-stub).

## REFACTOR-AUDIT-016 — Migrate 23 hand-rolled native `<button>` to shadcn `Button`

- **Verdict:** VERIFIED-FIXED
- **Evidence:** tree-wide `grep "<button" **/*.tsx` returns native `<button>` in only **two** files:
  `shared/components/ui/sidebar.tsx` (sanctioned shadcn primitive) and `-drive-file-picker.test.tsx`
  (a test). **Zero** native `<button>` remain in production component code (was 23 hand-rolled +
  ~33 total outside `ui/`). The cited `-project-issue-panel.tsx` controls were migrated into shared
  components that all import shadcn `Button`: `detail-meta-row.tsx:12`, `detail-description.tsx:9`,
  `detail-panel-header.tsx:13` (verified `<Button …>` usage in each).
- **Method:** Grep glob `*.tsx` for `<button`; read the destination shared components.
- **Note:** Approximate native `<button>` remaining in app surfaces ≈ 0.

## REFACTOR-AUDIT-017 — Translate the a11y-string tail

- **Verdict:** VERIFIED-FIXED
- **Evidence:** all spot-checked cited literals now route through i18n:
  - `-documents-tags.tsx:93` `aria-label={t("removeTag")}` (was "Remove tag").
  - `ui/sidebar.tsx:276,289` `t("common.toggleSidebar")` (sr-only + aria-label).
  - `ui/dialog.tsx:78` `<span className="sr-only">{t("common.close")}</span>`.
  - `-documents-create.tsx:68` `aria-label={t("field.documentTitle")}`.
  - `admin/-cron-row-actions.tsx:43` `aria-label={t("common.openActions")}` (also now a shadcn Button).
- **Method:** grep `aria-label=`/`sr-only` on each cited file.

## REFACTOR-AUDIT-018 — One loading-UX convention + dedup row/card scaffolding

- **Verdict:** PARTIAL — 5 of 6 named extractions done; shared `ListRow`/`ListTable` not extracted.
- **Evidence:**
  - ✅ **Skeletons / loading convention** — `shared/components/list-skeleton.tsx` exists and is
    consumed across `projects/index.lazy.tsx`, `ships/index.lazy.tsx`, `contacts/index.lazy.tsx`,
    `-project-procurement-tab.tsx`, `-project-issues-tab.tsx`, `-drive-file-list-inner.tsx`.
  - ✅ **PinToggle** — `shared/components/pin-toggle.tsx`, consumed by procurement-tab + issues-tab.
  - ✅ **TagBadgeList** — `shared/components/tag-badge-list.tsx`, consumed by projects/ships/contacts.
  - ✅ **PasswordPrompt** — `shared/components/share/previews/shell.tsx`, consumed by
    drive-preview + document-preview.
  - ✅ **(E.3) status colors** — `shared/lib/status-colors.ts:18-24` `CONTACT_VISIBILITY_BADGE` +
    `CONTACT_CONFIDENTIAL_BADGE`, consumed by `contacts/-contact-panel.tsx:33,162` (no longer
    hardcoded per-site).
  - ❌ **Shared `<ListRow>`/`<ListTable>`** — no such shared component exists
    (`shared/components/` has no `list-row`/`list-table`); the bordered row/hover-action scaffolding
    is still hand-rolled in `-project-procurement-tab.tsx`, `-project-issues-tab.tsx`,
    `contacts/index.lazy.tsx`.
- **Method:** `find`/grep for each named primitive + its importers.
- **Note:** Grouped low item; the loading-UX convention (the headline of D.4) and four of the named
  E-cluster extractions landed. Only the generic list-row shell (E.4) was not extracted.

## REFACTOR-AUDIT-019 — Architecture low config tweaks

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `exports["."]` — `apps/api/package.json:13-14` now points at `"./src/app.ts"`, a stable entry
    (the app factory: `app.ts` exports `bootstrap()` + `buildFullApp()`), not the throwaway `dev.ts`.
    Landed by commit `f12aa8f` ("…fix … api export").
  - Field-filter unit tests — `policy/permission.test.ts` covers `filterReadable` (`:92`, the
    `permission.ts:176` predicate: "returns a shallow copy with all fields when no read policy is set"
    + restricted-field cases) and a `filterWritable` describe block (`:156-196`, strip/reject modes).
  - `tsc -b` project references — the Action marked this **optional**; root `tsconfig.json` has no
    `references` block. Acceptable per the Action's "optional".
- **Method:** read `package.json` exports + `app.ts` exports; grep `filterReadable`/`filterWritable`
  in `permission.test.ts`; grep root `tsconfig.json` for `references`.

---

## Summary

| Item | Verdict |
|------|---------|
| FIX-AUDIT-005 | N/A-BY-DECISION |
| FIX-AUDIT-027 | VERIFIED-FIXED |
| FIX-AUDIT-028 | VERIFIED-FIXED |
| FIX-AUDIT-029 | VERIFIED-FIXED |
| FIX-AUDIT-030 | VERIFIED-FIXED |
| FIX-AUDIT-031 | PARTIAL |
| FIX-AUDIT-032 | VERIFIED-FIXED |
| REFACTOR-AUDIT-016 | VERIFIED-FIXED |
| REFACTOR-AUDIT-017 | VERIFIED-FIXED |
| REFACTOR-AUDIT-018 | PARTIAL |
| REFACTOR-AUDIT-019 | VERIFIED-FIXED |

**Non-VERIFIED items:**
- **FIX-AUDIT-005 — N/A-BY-DECISION:** no-encryption decision honored (redaction + bounds present);
  decision is documented in `serialize.ts` + commit `160beb7`, not as a `docs/decisions/` entry.
- **FIX-AUDIT-031 — PARTIAL:** ~5/7 representative lows fixed; residuals = service-token length
  short-circuit (`service-token.ts:35`) and procurement optimistic-version guard
  (`procurement.service.ts:307,382`), both rated negligible/optional by the original audit.
- **REFACTOR-AUDIT-018 — PARTIAL:** skeletons/PinToggle/TagBadgeList/PasswordPrompt/status-colors
  extracted; shared `ListRow`/`ListTable` shell (E.4) not extracted.
