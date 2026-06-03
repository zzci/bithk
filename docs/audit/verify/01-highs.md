# V1 — High-severity remediation verification (01-highs)

**Campaign:** `l1-w6c655lo-verify-20260603031707` · **Verifier:** V1 (`bkd/a1e5julw`)
**Base:** main @`146d991` (worktree HEAD `146d9917dc45c454b101c94eb45be517fbfbb014`)
**Mode:** verification-only / read-only on all source. The only file written is this report.

Source of truth: `docs/audit/remediation-backlog.md` §1 (the 3 highs) + dimension reports
(`backend.md`, `architecture.md`). Method = adversarial line-by-line read of the cited
`file:line` on the current tree + tree-wide grep for residual/bypass paths.

---

## FIX-AUDIT-001 — SSRF via redirect-following in cron http-request

- **Verdict:** VERIFIED-FIXED
- **Cited:** `apps/api/src/modules/cron/actions/http-request/executor.ts:191-194,224`
- **Intended Action:** set `redirect:"manual"` (or `"error"`) and re-run `isPrivateDestination`
  on every `Location` host before following.

**Evidence (current tree):**
- `executor.ts:236` — every request is issued with `redirect: "manual"`; `fetch` never
  auto-follows. The header comment (`:200-208`, `:234-235`) states the rationale exactly.
- `executor.ts:230-279` — manual redirect loop. Each hop calls `resolveTarget(ctx.config, currentUrl)`
  *before* fetching (`:231`), so the guard runs on the **initial URL and every redirect hop**.
- `resolveTarget` (`:141-194`) enforces the SSRF gate per call:
  - protocol allow-list `http:`/`https:` only (`:149-150`) — a redirect to `file://`/`gopher://` throws.
  - `isPrivateDestination(parsedUrl.hostname)` literal check (`:154-155`).
  - For non-IP-literal hosts: `dns.lookup(..., {all:true})` then `isPrivateDestination` on
    **every** resolved address (`:162-174`), and the connection is **pinned to the vetted IP**
    (`:175-180`, `connectHost`), so `fetch` performs no second resolution — closes the DNS-rebind
    TOCTOU window (stronger than the Action required).
  - decimal/hex/octal host tricks (`http://2130706433/`, `http://0x7f000001/`) are not IP literals,
    so they hit the DNS path; getaddrinfo resolves them to `127.0.0.1`, which `isPrivateDestination`
    rejects (`:172-173`).
- `executor.ts:263-278` — `Location` is resolved against the logical `currentUrl` (`new URL(location, currentUrl)`),
  the new URL becomes `currentUrl`, and the loop re-vets it on the next iteration. `MAX_REDIRECTS=5`
  (`:198`, `:266-267`) bounds chains; one shared `AbortSignal.timeout` (`:224`) bounds total time.

**Method:** full read of `executor.ts`; traced the redirect loop and `resolveTarget` guard;
reasoned through redirect-to-internal-IP and DNS-rebind bypass vectors.

**Note:** `HTTP_ACTION_ALLOW_PRIVATE=true` is a documented, deliberate per-deployment opt-out
(`:88-89`,`:153`), not a bypass. The fix exceeds the cited Action by also pinning DNS. No bypass found.

---

## FIX-AUDIT-002 — Backup restore wipes tables omitted from payload

- **Verdict:** VERIFIED-FIXED
- **Cited:** `apps/api/src/modules/backup/restore.service.ts:334-342`
- **Intended Action:** only `delete` tables that have a corresponding rowset in the backup, or
  validate the payload is complete-by-module before deleting.

**Evidence (current tree):**
- `restore.service.ts:340-344` — the delete loop is now guarded:
  ```
  for (const table of deleteOrder) {
    if (!Object.hasOwn(data.tables, getTableName(table)))
      continue;
    tx.delete(table).run();
  }
  ```
  A table is truncated **only** when its key is present in `data.tables`. A truncated/hand-edited
  upload that drops a table key entirely leaves that live table untouched — the exact root cause
  is removed. Comment `:334-339` documents the contract.
- Defense-in-depth: `deleteOrder`/`insertOrder` are derived from `data.modules`
  (`:314-316`, `getDeleteOrder` `:189-204`), and `validateBackupData` requires `modules` to be a
  non-empty array (`:137-139`) — so only tables belonging to modules the backup actually declares
  are even candidates for deletion, then the per-table `Object.hasOwn` guard narrows further.
- Whole operation runs inside `db.transaction` with `PRAGMA defer_foreign_keys = 1` (`:328-332`),
  so a partial delete/insert set still commits FK-consistently or rolls back.

**Adversarial check:** an explicit `{ tables: { projects: [] } }` (key present, empty array) *will*
truncate `projects` — but that is a deliberate "replace with empty" instruction and matches the
Action ("tables that have a corresponding rowset"); `validateBackupData:171-172` rejects any
non-array rowset, so a present key is always a real (possibly empty) rowset. The vulnerable case —
a key **absent** from the payload — is now skipped. No data-loss bypass found.

**Method:** full read of `restore.service.ts`; traced `importJsonBackup` delete path,
`validateBackupData` gating, and `getDeleteOrder` module scoping.

---

## REFACTOR-AUDIT-001 — Unify the API response envelope type

- **Verdict:** VERIFIED-FIXED
- **Cited:** `apps/web/src/shared/lib/api/projects.ts:17` (+13 siblings)
- **Intended Action:** define one discriminated `ApiEnvelope<T>`/`ApiListEnvelope<T>` in a single
  `web/lib/api/types.ts`, import everywhere; drop the 14 inline copies.

**Evidence (current tree):**
- Single source of truth exists: `apps/web/src/shared/lib/api/types.ts:7-17` defines
  `export interface ApiEnvelope<T>` and `export interface ApiListEnvelope<T>`.
- All **14** enumerated siblings (architecture.md Area B `:49`) now import from `./types` and carry
  **no** inline copy — verified by grep `import ... from "./types"`:
  `projects.ts:14`, `ships.ts:14`, `share.ts:15`, `documents.ts:10`, `drive.ts:18`, `search.ts:5`,
  `settings.ts:7`, `pins.ts:16`, `procurement.ts:10`, `tag-admin.ts:8`, `contacts.ts:3`,
  `contact-categories.ts:6`, `global-categories.ts:6`, `admin-default-cover.ts:9`.
- grep `interface ApiEnvelope|interface ApiListEnvelope|type ApiEnvelope|type ApiListEnvelope`
  across `apps/web/src` returns only the definition in `types.ts` plus one residual (see Note) —
  i.e. the 14 cited inline copies are gone. The single largest cross-cutting type-duplication
  (a response-shape change once touched 14 files) is eliminated.

**Method:** read `types.ts`, `projects.ts`, `http.ts`; grep for `ApiEnvelope`/`ApiListEnvelope`
declarations vs imports across `apps/web/src`; cross-checked count against architecture.md Area B.

**Note — two deviations from the written Action, neither undermining the cited root cause:**
1. The shipped envelope keeps `success: boolean`, **not** the *discriminated* `success: true | false`
   union the Action named. This is **defensible**: the web `http<T>` client throws `HttpError` on
   every non-2xx (`http.ts:64-91`), so a typed caller only ever receives the success envelope — the
   `success:false`/`error` branch is unreachable in the typed return, making a discriminant moot.
   `data` is therefore always present.
2. One residual inline `interface ApiEnvelope<T>` survives at
   `apps/web/src/app/routes/_app/projects/-project-issue-hooks.ts:18-21` — a route-level hook file
   **outside** the cited 14-file set. The broad "import everywhere" goal would ideally consolidate
   it too; it does not affect the enumerated finding. (Other `{ success: boolean; data }` literals
   in route/component/store files — e.g. `-policies-shared.ts`, `groups.lazy.tsx`, `auth.ts` — are
   ad-hoc inline `http<...>` response shapes, not part of REFACTOR-AUDIT-001's `api/`-layer scope.)

---

## Summary

| ID | Verdict |
|----|---------|
| FIX-AUDIT-001 | VERIFIED-FIXED |
| FIX-AUDIT-002 | VERIFIED-FIXED |
| REFACTOR-AUDIT-001 | VERIFIED-FIXED |

**Non-VERIFIED items:** none — all 3 assigned highs are VERIFIED-FIXED.

Caveat carried for L1/user awareness (does not change the verdict): REFACTOR-AUDIT-001's shared
envelope is non-discriminated (defensible — web `http` throws on error) and one inline `ApiEnvelope`
copy remains in `-project-issue-hooks.ts:18`, outside the cited 14-file scope.
