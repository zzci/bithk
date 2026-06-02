# Frontend Audit — `apps/web/src`

> Dimension: **frontend** (component/UI correctness & quality)
> Campaign: `l1-w6c655lo-audit-20260602135842` · AUDIT-ONLY (no code changes)
> Scope: `apps/web/src` — component duplication, state-management hygiene
> (TanStack Query / Zustand), accessibility, i18n coverage, error/loading-state
> handling.

## Method

- **Mechanical scans** (`grep`/`ripgrep` over `apps/web/src`): native `<button>`
  usage (33 sites outside `ui/`), hardcoded CJK, interactive `role="button"`
  elements, `console.*` (0 found — clean), `useQuery`/`useMutation` sites (27),
  `useTranslation` adoption (109/276 non-test files), `Skeleton` usage (1 site).
- **Targeted deep reads** of the shared primitives (`shared/components/*`,
  `shared/lib/{api,format,status-colors,tag-utils}.ts`, `query-client.ts`) and
  every per-module candidate (projects / ships / contacts / procurement / drive /
  documents / admin), with `pma-cr` (TS frontend pack) and `audit-context-building`.
- **Verification pass**: every finding below was opened and confirmed at the cited
  `file:line`. Several candidate findings were **dropped after verification**
  (see *Checked & clean* at the end) — notably the native `<button>` set, which
  all carry `type="button"` + `focus-visible` and are keyboard-accessible (a
  consistency issue, not an a11y break), and the `role="button"` elements, which
  all have correct `onKeyDown`/`tabIndex`/`aria-*`.

## Totals by severity

| severity | count |
|----------|-------|
| critical | 0 |
| high | 0 |
| medium | 19 |
| low | 24 |
| **total** | **43** |

**Calibration note:** the frontend is mature — high i18n adoption, disciplined
TanStack Query key factories with prefix-correct invalidation, optimistic update
with rollback in `documents.ts`, and consistent error/loading/empty handling in
the *primary* list/detail/panel views. No finding rises to high/critical: the
invalidation gaps self-heal within the 30 s `staleTime`, the error-swallowing
sites are secondary/admin views or write paths that don't corrupt data, and the
duplication carries divergence risk but no current defect. The value here is the
*band of mediums* (cache-vocabulary gaps, error-swallowing, panel duplication,
one CJK date) plus a long tail of low consistency items.

---

## A. Accessibility

Method: grep for `<button`/`role="button"`/`aria-label`, then read each site.

`app/routes/_app/projects/-project-issue-panel.tsx:364 -- severity: low -- confidence: high`
- rationale: 23 components hand-roll native `<button>` with re-implemented `focus-visible:ring-2 focus-visible:ring-ring` instead of the hard-locked shadcn `Button` (representative sites: `-project-issue-panel.tsx:364,485`, `-project-procurement-panel.tsx:372,598,717`, `-project-overview-tab.tsx:195,280`, `-project-issues-tab.tsx:396`, `-project-procurement-tab.tsx:243`, `projects/index.lazy.tsx:239`, `contacts/index.lazy.tsx:199`, `ships/-ship-overview-tab.tsx:180`, `documents/index.lazy.tsx:40`, `-documents-sidebar.tsx:328`, `-documents-search.tsx:84`, `-drive-sidebar.tsx:219,265`, `-drive-file-list-toolbar.tsx:158`, `-file-preview-pdf.tsx:56`, `admin/users/groups.lazy.tsx:401`, `-project-settings-dialog.tsx:150`, `shared/components/command-palette.tsx:215`, `resource/comment-section.tsx:537`, `share/share-dialog.tsx:277`, `share/previews/{drive,document}-preview.tsx`). All have `type="button"` and are keyboard-focusable, so this is a shadcn-consistency / maintainability issue, not a functional a11y break.
- suggested action: migrate to shadcn `Button` (variant `ghost`/`link` + `asChild` for row/nav cases) so focus-visible styling lives in one place; or document a sanctioned "bare interactive row" pattern.

`app/routes/_app/ships/index.lazy.tsx:196 -- severity: low -- confidence: high`
- rationale: ship grid card is a `<Card role="button" tabIndex={0}>` (also `admin/users/groups.lazy.tsx:279`, `admin/-policies-resource-groups.tsx:73`); all three correctly implement Enter/Space `onKeyDown` + `aria-label`/`aria-pressed`, so they are keyboard-accessible — but using `role="button"` on a `div`/`Card` is less robust than a semantic element.
- suggested action: prefer a real `<button>`/shadcn `Button` (or `Card` rendered `asChild` of a button) to inherit native semantics; low priority since keyboard/AT behaviour is already correct.

*(Icon-only controls were checked: every icon-only trigger carries `aria-label`, `title`, or `sr-only` text — no missing-name findings. Form inputs use `<Label htmlFor>`/`aria-label` consistently. Dialogs/drawers/command-palette have accessible titles via `DialogTitle`/`sr-only`. No findings.)*

---

## B. i18n coverage

Method: grep for CJK literals + literal strings in `placeholder=`/`title=`/`aria-label=`/visible JSX text, then read each to confirm it is user-facing.

`app/routes/_app/-documents-shared.ts:16 -- severity: medium -- confidence: high`
- rationale: `formatShortDate` returns a hardcoded CJK date `` `${d.getMonth() + 1}月${d.getDate()}日` `` — both a hardcoded-Chinese-in-code policy violation and a locale bypass (ignores the active i18n locale); `formatLongDate` (:19) likewise hardcodes `YYYY/M/D`.
- suggested action: format via `Intl.DateTimeFormat`/`shared/lib/format.ts` using the active locale, or drive the separators through `t(...)`.

`app/routes/_app/admin/-cron-create-drawer.tsx:186 -- severity: medium -- confidence: high`
- rationale: visible `<summary>Supported formats</summary>` is a hardcoded English label sitting directly beside translated siblings (`{t("form.scheduleCustomHelp")}`), so it stays English in the `zh` locale.
- suggested action: replace with `t("...supportedFormats")` (add the key to `cron.json`).

`app/routes/_app/-documents-tags.tsx:93 -- severity: low -- confidence: high`
- rationale: `aria-label="Remove tag"` hardcoded; screen-reader users in non-English locales hear English.
- suggested action: `aria-label={t("...removeTag")}`.

`shared/components/ui/sidebar.tsx:273 -- severity: low -- confidence: high`
- rationale: sidebar toggle hardcodes user/AT-facing English in three spots — `<span className="sr-only">Toggle Sidebar</span>` (:273), `aria-label="Toggle Sidebar"` (:285), `title="Toggle Sidebar"` (:288); `>Sidebar<` sr-only label at :197.
- suggested action: route through `t(...)` (sidebar primitive ships English defaults — wire to common namespace).

`shared/components/ui/dialog.tsx:76 -- severity: low -- confidence: high`
- rationale: `<span className="sr-only">Close</span>` hardcoded English in the dialog close button; same literal in `shared/components/ui/sheet.tsx:75`.
- suggested action: accept a translated close label (default `t("common.close")`).

`app/routes/_app/-documents-create.tsx:68 -- severity: low -- confidence: high`
- rationale: `aria-label="Document title"` hardcoded; identical untranslated label repeated at `app/routes/_app/-documents-detail.tsx:245`.
- suggested action: `aria-label={t("...field.title")}` (shared key for both call sites).

`app/routes/_app/admin/-cron-row-actions.tsx:43 -- severity: low -- confidence: high`
- rationale: `aria-label="open actions"` hardcoded on the row actions menu trigger.
- suggested action: `aria-label={t("common.openActions")}`.

`app/routes/_app/admin/-settings-webhook.tsx:197 -- severity: low -- confidence: high`
- rationale: example `placeholder="my-webhook"` (:197) and `placeholder="https://example.com/webhook"` (:201) are hardcoded; minor since they are example/format hints.
- suggested action: move to translated placeholder keys, or accept as locale-neutral examples (document the exception).

`app/routes/_app/admin/audit.lazy.tsx:240 -- severity: low -- confidence: medium`
- rationale: visible field labels `>ID<` (:240) and `>IP<` (:264) are hardcoded literals beside translated siblings; borderline because both are near-universal acronyms.
- suggested action: translate for consistency or leave by deliberate decision.

---

## C. State-management hygiene (TanStack Query / Zustand)

Method: enumerated every `queryKey` factory and grouped by resource, then traced
each mutation's `invalidateQueries` against the keys its queries actually read.

### C.1 Cache-invalidation gaps (new vocabulary/counts never refreshed)

`shared/lib/api/ships.ts:233 -- severity: medium -- confidence: high`
- rationale: `useCreateShip` (and `useUpdateShip` at :265) accept `tags` but only invalidate `shipKeys.lists()`; the tag-vocabulary key `shipKeys.tags()` (`["ships","tags"]`, :130) is never invalidated, so a newly introduced ship tag is missing from the list/edit tag filter until the 30 s `staleTime` lapses. Procurement (`procurement.ts`) does invalidate its tag vocab — this is the inconsistent one.
- suggested action: add `invalidateQueries({ queryKey: shipKeys.tags() })` to `useCreateShip`/`useUpdateShip` `onSuccess`.

`shared/lib/api/ships.ts:233 -- severity: medium -- confidence: high`
- rationale: ship create/update/delete/cover (`:233,:265,:310`, covers) all invalidate `shipKeys.lists()` but never `shipKeys.count(status)` (`["ships","count",status]`, :131) read by `useShipCount`; fleet KPI counts stay stale after add/remove/status-change.
- suggested action: invalidate the `["ships","count"]` prefix in create/update/delete `onSuccess`.

`shared/lib/api/contacts.ts:174 -- severity: medium -- confidence: high`
- rationale: `useCreateContact` (and `useUpdateContact` at :187) accept `tags` but invalidate only `contactKeys.all`/`contactKeys.detail`; `contactTagKeys.vocabulary` (`["tags","contact"]`, :91) is a *sibling* of `["contacts"]`, not a child, so it is never invalidated and the contact tag filter shows stale vocabulary after a new tag is created.
- suggested action: add `invalidateQueries({ queryKey: contactTagKeys.vocabulary })` to create/update `onSuccess`.

`shared/lib/api/documents.ts:227 -- severity: low -- confidence: high`
- rationale: `useCreateDocument` invalidates `documentsKeys.tree()` only; `useUpdateDocument` (:260) correctly also invalidates `documentsKeys.tags()` (:294), so a doc *created* with a brand-new tag leaves the document tag filter stale (update path is fine).
- suggested action: add `invalidateQueries({ queryKey: documentsKeys.tags() })` to `useCreateDocument` `onSuccess`.

### C.2 `useEffect`/raw-fetch where `useQuery` belongs

`shared/components/settings-dialog.tsx:132 -- severity: medium -- confidence: high`
- rationale: `TotpTab` fetches `/account/me/totp` via `useState`+`useEffect`+`fetchDevices` (:143,:154) and hand-mutates local state (`setDevices(prev => prev.filter(...))`) instead of a `useQuery`/`useMutation` pair — no shared cache, no dedup, manual refetch wiring.
- suggested action: model devices as `useQuery(["account","totp"])` and invalidate from confirm/delete mutations.

`app/routes/_app/admin/-settings-shared.tsx:27 -- severity: medium -- confidence: high`
- rationale: `useSettingsByPrefix` is a hand-rolled `useState`+`useEffect`+manual `refetch` hook (:28-47; consumed by `-settings-smtp/-webhook/-auth.tsx`) that bypasses the proper TanStack settings layer in `shared/lib/api/settings.ts` (`useSetting`/`usePutSetting`, keyed `["settings",key]`); the two layers can diverge for the same key and there is no cache write on save/delete.
- suggested action: replace with a `useQuery(["settings","prefix",prefix])` + mutations that invalidate, or extend `settings.ts` with a prefix/list query.

### C.3 Key precision / dead keys / store selectors (minor)

`shared/lib/api/projects.ts:559 -- severity: low -- confidence: high`
- rationale: `useCreateProjectIssue` invalidates both `projectKeys.issues(projectId,"")` (:559) and `["projects",projectId,"issues"]` (:560); the second is a prefix of the first, so :559 is fully redundant. Same redundancy in `-project-issue-hooks.ts:71-72`.
- suggested action: drop the narrower `issues(projectId,"")` invalidation — the bare prefix already matches every issues-list variant.

`shared/lib/api/documents.ts:171 -- severity: low -- confidence: high`
- rationale: `documentsKeys.attachments` (:171) / `documentsKeys.comments` (:172) are defined but never referenced (grep: 0 uses); the live queries use the generic `attachmentsQueryKey`/`commentsQueryKey` in `shared/components/resource/*` that produce the identical `["documents",id,"attachments"]` shape — two definitions of one logical key invite divergence.
- suggested action: delete the unused members, or have the resource sections consume them, so there is one source of truth.

`shared/components/resource/footer-sections.tsx:78 -- severity: low -- confidence: medium`
- rationale: the same attachments `useQuery` is declared inline in three places (`attachment-section.tsx:83`, `footer-sections.tsx:78`, `use-attachment-upload.ts:33`) via the shared key helper; dedup works, but the duplicated `queryFn`/options must be changed in 3 spots.
- suggested action: extract one `useResourceAttachments(resource, resourceId)` hook used by all three.

`app/routes/_app.tsx:37 -- severity: low -- confidence: medium`
- rationale: several consumers destructure the whole Zustand auth store (`_app.tsx:37` `{ user, loading, fetchUser }`, `app-sidebar.tsx:149` `{ user, logout }`, `settings-dialog.tsx` `{ user }`) instead of field selectors; any store change re-renders them. Most other sites correctly use `useAuthStore(s => s.user)`. Low impact (auth store mutates rarely).
- suggested action: switch to field selectors for consistency.

*(Checked clean: stores never mutate state in place; no derived/duplicated store state; `documents.ts` optimistic update has correct rollback; drive/projects/procurement/pins mutations invalidate correctly; share-preview raw-fetch is justified — public, password-gated, abortable, intentionally off the authed `http` client; no prop-drilling >3 levels.)*

---

## D. Error & loading-state handling

Method: enumerated `useQuery`/`useMutation` sites and read each consumer for
`isError`/`error`/`onError`/`isLoading`/empty-state branches.

### D.1 App-wide

`app/routes/__root.tsx:12 -- severity: medium -- confidence: high`
- rationale: `createRootRoute` sets `notFoundComponent` but **no `errorComponent`**; an uncaught query/render error in any route has no graceful router boundary (the `/error` route is only reached by explicit navigation), so failures degrade to a white screen.
- suggested action: add `errorComponent` to the root route rendering a retry-able fallback (reuse the `status === "db-error"` panel pattern already in `__root.tsx`).

`app/providers.tsx:12 -- severity: medium -- confidence: high`
- rationale: no React `ErrorBoundary` wraps the tree and `query-client.ts` has no `QueryCache.onError`; there is no catch-all, so the per-component gaps below fall through to blank UI.
- suggested action: wrap `{children}` in an `ErrorBoundary` (and/or add a global `QueryCache.onError` toast) as a safety net.

### D.2 Query errors swallowed into empty-state

`app/routes/_app/projects/-project-overview-tab.tsx:40 -- severity: medium -- confidence: high`
- rationale: `latestIssuesQuery` (:40) and `latestProcurementsQuery` (:41) feed `LatestActivityCard`, which accepts `isLoading`/`isEmpty` but **no error prop** (:238); on fetch failure `data` is undefined → `isEmpty` true → the card shows "no items" with no retry, so a load failure masquerades as empty.
- suggested action: thread an `isError` flag into `LatestActivityCard` and render an inline error/retry before the empty branch.

`app/routes/_app/-share-lists.tsx:249 -- severity: medium -- confidence: high`
- rationale: `ReceivedSharesList` passes only `loading={query.isLoading}` and never the surface's `banner`; on `useReceivedShares` error → `shares=[]` → "Shared with me" shows empty-state (a refresh button exists, but the failure is unsignalled).
- suggested action: pass an error banner (the surface already supports `banner`) when `query.error` is set.

`app/routes/_app/-share-lists.tsx:268 -- severity: medium -- confidence: high`
- rationale: `OutgoingSharesList` combines `useSentShares` + `useLinkShares` and passes only `loading` (:300); either query failing yields an empty "Shared by me" list with no error indication.
- suggested action: surface `sentQuery.error ?? linksQuery.error` through the surface `banner`.

`app/routes/_app/admin/-policies-tuples.tsx:38 -- severity: medium -- confidence: high`
- rationale: `TupleManager` destructures only `{ data, isLoading }` — no `isError`/`error`; on `/tuples` failure the table renders "noTuples" (:104) instead of an error.
- suggested action: destructure `isError`/`error` and render an error row before the empty branch.

`app/routes/_app/admin/-policies-resource-groups.tsx:24 -- severity: medium -- confidence: high`
- rationale: both list queries — groups (:24) and members (`ResourceGroupMemberList` :303) — destructure only `{ data, isLoading }`; failures render "noResourceGroups"/"noMembers" empty states (the mutations here *are* wired with `onError`, so this is query-only).
- suggested action: surface `isError`/`error` on both queries.

`app/routes/_app/documents/index.lazy.tsx:18 -- severity: medium -- confidence: high`
- rationale: `useDocumentTree()` has no error branch; on failure `data` is undefined → `pinned=[]` → the page renders the "create your first document" empty state (:28), masking a load failure (partly mitigated — the shared layout `documents.lazy.tsx:112` does pass `error` to the sidebar).
- suggested action: check `treeQuery.error` and render an error/retry in the main pane.

`app/routes/_app/projects/-project-overview-tab.tsx:151 -- severity: low -- confidence: high`
- rationale: `ProjectPinnedCard` handles loading/empty (:163) but not `.error`; a failed pinned-items fetch renders "no pinned" instead of an error.
- suggested action: add an error branch before the empty branch.

### D.3 Mutations with no error feedback (silent write failure)

`app/routes/_app/ships/$shipId.lazy.tsx:84 -- severity: low -- confidence: high`
- rationale: `handleDelete` calls `deleteShip.mutate(ship.id, { onSuccess })` with **no `onError`**; a failed ship delete gives no feedback (other ship mutations surface errors via `ErrorBanner`, so this is inconsistent). Not data-corrupting: on failure the list isn't invalidated, so the ship stays visible.
- suggested action: add `onError` toast (e.g. `t("common.error.deleteFailed")`).

`app/routes/_app/contacts/index.lazy.tsx:350 -- severity: low -- confidence: high`
- rationale: `deleteContact.mutate(..., { onSuccess })` has no `onError`; create/update surface `panelError`, delete is silent.
- suggested action: add `onError` toast (or surface `deleteContact.error` by the confirm dialog).

`app/routes/_app/-share-lists.tsx:199 -- severity: low -- confidence: high`
- rationale: `revoke.mutate(share.id)` (in `getCustomActions`) has neither `onError` nor success feedback; a failed share revoke is silent.
- suggested action: add `onError` (and optional success) toast.

`app/routes/_app/admin/-policies-tuples.tsx:43 -- severity: low -- confidence: high`
- rationale: the inline-row `deleteMutation` (:43, used at :133) has no `onError`; the create/edit dialogs do show `mutation.error` (:315,:378), but row delete failures are silent.
- suggested action: add `onError` toast to the delete mutation.

### D.4 Loading-UX consistency

`shared/components/ui/skeleton.tsx:1 -- severity: low -- confidence: high`
- rationale: loading UX is inconsistent — the reusable `<Skeleton>` is used in ~1 place; lists variously use a `Loader2` spinner (`ships/index.lazy.tsx:89`), centered muted text (`projects/index.lazy.tsx:143`, `contacts/index.lazy.tsx:172`, `-project-procurement-tab.tsx:221`), or a full-width table "loading" cell. No list/grid skeletons → text-flash + content-shift on load.
- suggested action: pick one convention (skeleton rows/cards for lists; reserve the spinner for background refetch) and apply consistently.

*(Well-handled for calibration: `-documents-detail.tsx:134` loading+error+version-conflict; `-project-issue-panel.tsx` / `-project-procurement-panel.tsx` loading + error fallback + mutation `onError`→banner; `-ship-equipment-tab.tsx` query + 3 mutation error banners + empty state; `admin/users/*`, `cron.lazy.tsx`, `audit.lazy.tsx` manual-fetch with explicit error+loading+empty.)*

---

## E. Component duplication

Method: read shared primitives first, then compared per-module candidates
line-by-line; cited all copies.

### E.1 Issue panel vs procurement panel (largest cluster)

`app/routes/_app/projects/-project-procurement-panel.tsx:282 -- severity: medium -- confidence: high`
- rationale: header comment says "A 1:1 port of `-project-issue-panel.tsx`"; the entire meta row (status/priority `Select`+`Badge`, assignee picker, due-date `showPicker` + sr-only date input, attachment/edit actions, hidden file input) at :282-445 duplicates `-project-issue-panel.tsx:273-437` near-verbatim.
- suggested action: extract a shared `<DetailMetaRow>` with slots, consumed by both panels.

`app/routes/_app/projects/-project-issue-panel.tsx:456 -- severity: medium -- confidence: high`
- rationale: the description block (`MarkdownEditor` edit/readonly/dashed-empty button, `bg-muted/40 p-3`), creator+timestamp footer, `handleKeyDown` Escape logic, `saveDesc`/`cancelDesc`, and `useResourceAttachmentUpload` wiring are duplicated in `-project-procurement-panel.tsx:186-231` and `:569-631`.
- suggested action: extract a shared description-editor block + inline-edit/upload hook.

`app/routes/_app/projects/-project-issue-panel.tsx:60 -- severity: low -- confidence: high`
- rationale: the priority→`Badge`-variant map (`low:"secondary" … urgent:"destructive"`, :60-64) is copied verbatim as `PRIORITY_VARIANTS` in `-project-procurement-panel.tsx:64-68`; both comment "keep in sync".
- suggested action: move the map to `shared/lib/` (beside `priority-signal.tsx`) and import in both.

### E.2 Per-module tag comboboxes (byte-identical)

`app/routes/_app/projects/-project-tags-combobox.tsx:1 -- severity: medium -- confidence: high`
- rationale: `ProjectTagsCombobox` is identical to `ships/-ship-tags-combobox.tsx:1` after normalizing the namespace — a `diff` ignoring the `suggestions`/`availableTags` prop name and the doc comment yields **0 differing lines** (the ship file's comment even calls itself a "mirror of the project tags combobox").
- suggested action: extract one shared `<TagsCombobox value/onChange/suggestions + labels>` and delete both copies.

### E.3 Status/color logic bypassing `shared/lib`

`app/routes/_app/contacts/-contact-panel.tsx:161 -- severity: low -- confidence: high`
- rationale: the visibility badge (`"bg-info/10 text-info"` vs `"bg-muted text-muted-foreground"`, :161) and confidential badge (`"bg-warning/10 text-warning"`, :170) are duplicated verbatim in `contacts/index.lazy.tsx:215` and `:218`, and both bypass the central `shared/lib/status-colors.ts` registry.
- suggested action: add `CONTACT_VISIBILITY_BADGE`/confidential constants to `status-colors.ts` and reference from both.

`app/routes/_app/ships/-ship-colors.ts:16 -- severity: low -- confidence: medium`
- rationale: `EQUIPMENT_STATUS_BADGE.active = "bg-success/10 text-success"` re-hardcodes the token string `RECORD_STATUS_BADGE.active` already defines in `shared/lib/status-colors.ts` (which this file *already imports* for `SHIP_STATUS_BADGE`); the muted "retired" string is likewise re-typed.
- suggested action: derive `EQUIPMENT_STATUS_BADGE` from the shared `RECORD_STATUS_BADGE` values.

### E.4 Repeated list-row / card scaffolding

`app/routes/_app/projects/-project-procurement-tab.tsx:240 -- severity: medium -- confidence: medium`
- rationale: the bordered list table (header sharing a `*_GRID` template, `<ul>` of `group … hover:bg-muted/50 <li>` rows, focusable row button, hover-revealed action/pin column) at :225-268 mirrors `-project-issues-tab.tsx:383-438` and `contacts/index.lazy.tsx:176-291`; the row chrome + hover-action pattern is repeated three times (columns differ).
- suggested action: extract a generic `<ListRow>`/`<ListTable>` shell (grid template + hover-action slot) and let modules supply cells.

`app/routes/_app/projects/-project-procurement-tab.tsx:302 -- severity: low -- confidence: high`
- rationale: `ProcurementPinToggle` (ghost pin/unpin button + toasts) duplicates `IssuePinToggle` at `-project-issues-tab.tsx:468`; only the mutation hook + i18n keys differ.
- suggested action: extract a shared `<PinToggle toggleMutation labels>`.

`app/routes/_app/ships/index.lazy.tsx:251 -- severity: low -- confidence: high`
- rationale: the "first N tags as `Badge` + `+N more`" overflow snippet at :251-264 duplicates `projects/index.lazy.tsx:275-285` and a `slice(0,2)/+N` variant in `contacts/index.lazy.tsx:235-240`.
- suggested action: extract a `<TagBadgeList max={N}>` helper.

### E.5 Share-preview password prompt / file-icon header

`shared/components/share/previews/document-preview.tsx:163 -- severity: low -- confidence: high`
- rationale: the password-prompt form (icon tile + truncated-name header, `<Lock>` label, password `<Input>`, submit) duplicates `drive-preview.tsx:133-157` and `:248-272`; drive already factored a `PasswordField` (`drive-preview.tsx:374`) but document-preview reimplements it, and the `size-11 … rounded-lg bg-primary/10` icon header repeats 3×.
- suggested action: promote one `PasswordPrompt` (icon header + `PasswordField` + submit) into `previews/shell.tsx`.

### E.6 Local date formatters bypassing `shared/lib/format.ts`

`app/routes/_app/-file-browser-types.ts:71 -- severity: low -- confidence: medium`
- rationale: local `formatDate` (manual `YYYY-MM-DD` with `pad`) and `-documents-shared.ts:11/19` bypass the locale-aware `shared/lib/format.ts` (`formatDate`/`formatDateTime`) used everywhere else (admin/projects/ships). (The `-documents-shared.ts` CJK literal is also tracked under **B / `-documents-shared.ts:16`**.)
- suggested action: route these call sites through `shared/lib/format` where a localized date is acceptable.

---

## Remediation priority (suggested order, for a future approved fix campaign)

1. **Cache-vocabulary invalidation gaps** — `ships.ts` tags+count, `contacts.ts`
   vocab, `documents.ts` create tags (C.1). Smallest diffs, removes user-visible
   stale-filter behaviour.
2. **App-wide error boundary** + the error-swallowing query sites (D.1, D.2) —
   make load failures visible instead of fake-empty.
3. **Panel + tag-combobox de-duplication** (E.1, E.2) — highest divergence risk;
   the panels already drift ("keep in sync" comments).
4. **i18n cleanups** — CJK date format + `Supported formats` label (B), then the
   a11y-string tail.
5. **shadcn `Button` migration + loading-UX convention** (A, D.4) — broad but
   low-risk consistency sweep.
