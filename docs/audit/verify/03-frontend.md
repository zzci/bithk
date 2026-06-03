# V3 — Frontend Remediation Verification

**Campaign:** `l1-w6c655lo-verify-20260603031707` · VERIFICATION-ONLY (read-only on all source)
**Base:** `main @146d991` (worktree branch `bkd/hw7xmsbw`)
**Scope:** FIX-AUDIT-021..025, REFACTOR-AUDIT-012 — paths under `apps/web/src/`
**Source of truth:** `docs/audit/remediation-backlog.md` §3b + `docs/audit/frontend.md` §A–E

Method (all items): opened each cited `file:line` on the current tree, confirmed
the backlog Action was actually applied and that it removes the root cause (not a
superficial change), grepped for residual duplicate/hardcoded patterns and for the
i18n keys the new code introduces, and verified consumers still compile against the
new shapes. No source was modified.

---

## FIX-AUDIT-021 — No app-wide error boundary (white-screen)

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `apps/web/src/app/routes/__root.tsx:15` — root route now sets `errorComponent: RootErrorComponent` (alongside the pre-existing `notFoundComponent`). The component (`:25-52`) renders a reloadable destructive panel with collapsible `error.message`, mirroring the `db-error` panel.
  - `apps/web/src/app/providers.tsx:29-44` — a real React `AppErrorBoundary` class (`getDerivedStateFromError`) wraps `{children}` at `:102`, the catch-all above the router.
  - `apps/web/src/app/providers.tsx:81-95` — `QueryErrorToaster` subscribes to `queryClient.getQueryCache()` and toasts on hard failures, deliberately skipping 4xx (401 bounces to login; others surface inline). This is the `QueryCache.onError` catch-all the backlog asked for, implemented via a cache subscription.
  - i18n keys used (`common.error.systemUnavailable`, `common.errorDetails`, `common.retry`, `common.error.loadFailed`) all present in `locales/{en,zh}/common.json`.
- **Method:** read both cited files end-to-end; grepped locales for every key referenced by the new components.
- **Note:** Root cause removed on three layers (router boundary + React boundary + query-cache toaster). Both root and React fallbacks offer a reload action.

## FIX-AUDIT-022 — Query errors swallowed into empty-state (cluster)

- **Verdict:** VERIFIED-FIXED (all 6 cited surfaces, plus the two low-severity siblings)
- **Evidence:**
  - `-project-overview-tab.tsx` — `LatestActivityCard` gained `isError`/`onRetry` props (`:252-253`) and renders `ListErrorState` **before** the `isEmpty` branch (`:278-281`); both call sites thread `isError`+`onRetry` (`:58-59`, `:84-85`). The low-severity `ProjectPinnedCard` (audit D.2 `:151`) now also branches on `pinnedQuery.isError` → `ListErrorState` before empty (`:181-184`). New `ListErrorState` at `:141-149`.
  - `-share-lists.tsx` — `ShareListSurface` accepts `isError`/`error` (`:139-140`), builds an `ErrorBanner` (`:233-235`), passes it via `banner=` to `DriveFileListSurface`; `ReceivedSharesList` threads `isError`/`error` (`:271-272`) and `OutgoingSharesList` threads `sentQuery.isError || linksQuery.isError` / `sentQuery.error ?? linksQuery.error` (`:319-320`). Confirmed `-drive-file-list-surface.tsx:290` renders `{banner}` above the empty-state branch (`:293`).
  - `admin/-policies-tuples.tsx:40` — `useQuery` destructures `isError`/`refetch`; error row with retry rendered before the `noTuples` empty row (`:104-120`).
  - `admin/-policies-resource-groups.tsx` — groups query (`:24` → error/retry `:60-66` before `noResourceGroups` `:67`) and `ResourceGroupMemberList` query (`:310` → error/retry `:332-338` before `noMembers` `:340`).
  - `documents/index.lazy.tsx:31-40` — `treeQuery.isError` short-circuits to an error/retry pane before the create empty-state (`:43`).
- **Method:** read each consumer; confirmed the error branch is ordered ahead of the empty branch; verified the share surface actually paints the `banner`.
- **Note:** Genuine fix — a load failure can no longer masquerade as "empty". Retry wired everywhere.

## FIX-AUDIT-023 — Cache-invalidation vocab/count gaps

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `shared/lib/api/ships.ts` — `useCreateShip.onSuccess` invalidates `lists()` + `tags()` + `counts()` (`:232-235`); `useUpdateShip.onSuccess` invalidates `detail` + `lists()` + `tags()` + `counts()` (`:269-273`); `useDeleteShip.onSuccess` invalidates `lists()` + `counts()` (`:317-319`). `counts()` = `["ships","count"]` (`:121`) is the prefix of `count(status)` (`:122`), so all KPI counts drop.
  - `shared/lib/api/contacts.ts` — `useCreateContact.onSuccess` invalidates `contactKeys.all` + `contactTagKeys.vocabulary` (`:172,175`); `useUpdateContact.onSuccess` adds `vocabulary` too (`:188-191`). `vocabulary = ["tags","contact"]` is a sibling of `["contacts"]`, now explicitly invalidated.
  - `shared/lib/api/documents.ts` — `useCreateDocument.onSuccess` invalidates `tree()` + `tags()` (`:232,234`); `useUpdateDocument` already invalidated `tags()` (`:290`).
- **Method:** grepped each key factory + every mutation `onSuccess`; matched against the queries the filters read.
- **Note:** Cover mutations (`useSetShipCover`/`useRemoveShipCover`, `:289-291`,`:302-304`) intentionally do not invalidate `counts()` — a cover change alters neither status nor existence, so no count goes stale; the backlog Action scoped counts to create/update/delete only. Correct.

## FIX-AUDIT-024 — Hardcoded CJK date + English Supported-formats label

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `app/routes/_app/-documents-shared.ts:15-24` — `formatShortDate` now formats via `new Intl.DateTimeFormat(toIntlLocale(i18n.language, ...), { month:"short", day:"numeric" })`; the hardcoded `` `${m}月${d}日` `` is gone. `formatLongDate` (`:26-29`) delegates to the locale-aware `shared/lib/format.formatDate`. `toIntlLocale` is a real exported, BCP-47-validating helper (`shared/lib/locale.ts:24`).
  - `app/routes/_app/admin/-cron-create-drawer.tsx:186` — the `<summary>` now reads `{t("form.supportedFormats")}`; grep for the literal "Supported formats" across `app/`+`shared/` returns nothing.
  - Key `cron.form.supportedFormats` present in both locales (`en`="Supported formats", `zh`="支持的格式").
- **Method:** read the formatter + drawer; grepped for residual hardcoded CJK/English literals and verified the new key in both locale files.

## FIX-AUDIT-025 — Hand-rolled fetch where useQuery belongs

- **Verdict:** VERIFIED-FIXED
- **Evidence:**
  - `shared/components/settings-dialog.tsx` — `TotpTab` now uses `useQuery({ queryKey: totpDevicesKey=["account","totp"], queryFn })` (`:136,148-154`) and `useMutation` for create/confirm/delete (`:157,165,176`) with `invalidateQueries(totpDevicesKey)` on confirm/delete (`:172,179`). Grep confirms no remaining `fetchDevices`/`setDevices`/`useEffect` manual-refetch wiring in the file.
  - `app/routes/_app/admin/-settings-shared.tsx:30-69` — `useSettingsByPrefix` is now a `useQuery` keyed `settingsPrefixKey = [...settingKeys.all,"prefix",prefix]` (`:31`), nested under the shared `["settings"]` namespace (`settingKeys.all`, `settings.ts:17`) so the save path's `invalidateQueries(settingKeys.all)` drops these list caches — the two layers can no longer diverge. `SettingsCard` save uses `useMutation` + `invalidateQueries(settingKeys.all)` (`:130-145`). No `useEffect` remains in the file. The hook preserves its `{settings,loading,error,setError,refetch}` return shape, so all consumers (`-settings-auth/-smtp/-webhook.tsx`) keep working.
  - Key `common.error.saveFailed` present in both locales.
- **Method:** read both modules fully; grepped for leftover `useEffect`/manual-refetch primitives and for the consumers of the refactored hook.

## REFACTOR-AUDIT-012 — De-duplicate issue/procurement panels + tag combobox

- **Verdict:** VERIFIED-FIXED (all four extractions delivered and consumed)
- **Evidence:**
  - **TagsCombobox:** `shared/components/tags-combobox.tsx` holds the single implementation (+ `tags-combobox.test.tsx`). `projects/-project-tags-combobox.tsx` is now a 1-line re-export; `ships/-ship-tags-combobox.tsx` is a thin adapter passing `namespace="ships"`. The previously byte-identical copies are gone.
  - **DetailMetaRow:** `shared/components/detail-meta-row.tsx` exports `DetailMetaRow`/`MetaSeparator`/`MetaSelectBadge`/`MetaAssignee`/`MetaDueDate`/`MetaActions`. Both panels import and render them (`-project-issue-panel.tsx:17-25,257-315`; `-project-procurement-panel.tsx:22-30,275-334`). The duplicated `showPicker` due-date strip is no longer inline in either panel.
  - **Description-editor block:** `shared/components/detail-description.tsx` is a complete extraction (edit `MarkdownEditor` / readonly render / dashed-empty affordance / muted placeholder), consumed by both panels (`-project-issue-panel.tsx:335`, `-project-procurement-panel.tsx:459`).
  - **Priority-variant map:** `shared/components/priority-variant.ts:9` exports `PRIORITY_BADGE_VARIANT`; both panels import it (`:27`/`:32`) and use it (`:276`/`:294`). The verbatim `PRIORITY_VARIANTS` copies and the "keep in sync" comments are gone.
- **Method:** located the four shared modules; confirmed both panels + both comboboxes import/consume them; grepped for residual `PRIORITY_VARIANTS`/`showPicker`/"keep in sync" duplication (none remain).
- **Note:** The panels' header comments still read "1:1 port of …" — stale documentation only; the shared meta-row, description, priority map, and tag combobox are genuinely de-duplicated. Residual per-panel length is field-specific wiring (issue vs procurement differ), which the backlog Action did not target.

---

## Summary

All assigned items: **VERIFIED-FIXED.**

- FIX-AUDIT-021 = VERIFIED-FIXED
- FIX-AUDIT-022 = VERIFIED-FIXED
- FIX-AUDIT-023 = VERIFIED-FIXED
- FIX-AUDIT-024 = VERIFIED-FIXED
- FIX-AUDIT-025 = VERIFIED-FIXED
- REFACTOR-AUDIT-012 = VERIFIED-FIXED

**Non-VERIFIED items:** none.

Minor (non-blocking) observations, not regressions: stale "1:1 port" header comments
on the two project panels (REFACTOR-AUDIT-012).
