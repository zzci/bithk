# Changelog

Track changes your fork makes on top of this template. Format adapted from
[Keep a Changelog](https://keepachangelog.com/) — group entries under
**Added / Changed / Removed / Fixed / Security**. The `Unreleased` block
holds work since your last tag.

Upstream cuts versioned tags so forks can anchor diffs against a known
template version. The boundary entries below summarise what shipped in
each upstream tag; your fork's `Unreleased` block sits at the top.

## Unreleased

### Added

- **Overview workbench + user favorites** (FEAT-048, PLAN-103). The overview
  page now shows the caller's starred content and cross-project work instead
  of static navigation tiles:
  - New standalone `user_favorites` table (own `overview` module, migration
    0006) — type-generic `(userId, targetType, targetId)`; no changes to any
    other module's schema. `PUT/DELETE /favorites/:type/:id` (idempotent,
    fail-closed 404 on invisible targets) and `GET /favorites` (hydrated,
    visibility re-checked per read; hard-deleted targets pruned lazily).
    Types wired in v1: `project`, `issue`, `procurement`.
  - `GET /overview` aggregates: up to 10 open issues assigned to the caller
    and 10 non-terminal procurements across projects where they hold
    `procurement.view` (membership/capability scoping mirrors the
    per-project routes; admins see all).
  - Web: star toggles on project list cards, the project detail header, and
    the issue / procurement detail panels; the overview page renders
    Favorites / My work orders / Open procurements sections with empty
    states. Callers without the `projects` module keep the module-gated
    quick-nav tiles.

### Changed

- **Web API types are now generated from the OpenAPI spec** (FEAT-049 +
  REFACTOR-037, PLAN-105). `gen:api-types` (openapi-typescript) emits committed
  types from `api-spec.json` with a `check:api-types` drift gate in `check`;
  all 30 `shared/lib/api` modules consume generated aliases instead of
  hand-mirrored view types (net -476 lines). Known spec-vs-server describeRoute
  gaps are catalogued as TODO(spec) for a follow-up backend fix.
- **Migrations collapsed to a fresh baseline** (REFACTOR-036). 0000-0008 folded
  into a single drizzle-kit-generated 0000; existing dev DBs must be reseeded
  (`bun run seed`); deployed instances restore via backup import. ADR-014
  records HR's flat module-gate RBAC as deliberate (DOC-001).

- **CI: macOS matrix leg removed** (FIX-058). The `check` job now runs on
  `ubuntu-latest` only — the app deploys exclusively to Linux (Docker/lode)
  and the mac leg doubled the heaviest job at ~10x runner cost. Re-add
  `macos-latest` to the matrix if mac CI is ever needed again.
- **Architecture remediation** (PLAN-104, 13 tasks from the 2026-07-02
  architecture assessment):
  - API wiring: route-table now composes the real route factories (fixing
    registry drift that hid the storage admin routes from generated docs);
    nav-gate / PAT-scope / prefix matching derive from a single module
    manifest; search sources register via `registerSearchSource`, removing
    the search module's imports of domain internals.
  - Route-layer dedup: shared item-attachment route factory across
    issue / procurement / document / hr (procurement delete auth unified);
    `okJson` / `parseTagIds` / pagination / `auditFromCtx` helpers deduped
    into shared libs; services extracted from oversized auth / cron / users
    route files.
  - Correctness & data layer: policy middleware fail-open branch closed
    (with direct tests); contact list capability resolution batched (N+1);
    document cascade delete and drive purge made transactional; FK indexes,
    tuple `onDelete`, drive timestamp normalization, scheduled
    `PRAGMA optimize`, payroll insert transaction.
  - Quality gates: `check:routes` deduped out of `check`, CI coverage parsed
    from the check step, api dev `--watch`, bun install cache, scoped flake
    retry, `tests/` linted.
  - Web: inline query keys and direct `http()` call sites moved into the
    shared api layer with `keepPreviousData` on paginated lists; god
    components split into co-located units with static i18n label maps and
    memoized list rows.
  - Coverage: live-API e2e suites added for file, share, project,
    procurement, hr, and document authz.

## v0.1.9 — 2026-07-01

### Added

- S3-compatible storage driver (default target **Cloudflare R2**) with presigned
  direct upload and an image preview cache (FEAT-044, PLAN-096), built on Bun's
  native `S3Client` + `Bun.Image` (no new dependencies):
  - **Driver** (`FILE_STORAGE_DRIVER=s3`, `FILE_S3_*`): put/get/delete/exists
    plus presigned GET for inline previews. Attachment downloads keep streaming
    through the API (Bun's presign can't sign `Content-Disposition`).
  - **Direct upload**: the drive uploads bytes straight to S3 —
    `POST /drive/files/presign-upload` (the client computes the sha256; an
    already-stored hash finishes instantly with no upload) → browser `PUT` to the
    presigned URL → `POST /drive/files/confirm-upload` (HEADs the object for its
    authoritative size). Size is enforced by the S3 backend plus an orphan sweep
    that reclaims unconfirmed objects after `FILE_S3_ORPHAN_TTL_HOURS`.
    `GET /system/upload-limits` reports `directUpload` so the web uploader
    feature-detects; the local driver keeps the multipart-through-API path.
  - **Image preview cache**: inline image requests with `?thumb=<w>` are served
    as cached WebP thumbnails (same-origin, `immutable`, `ETag`); the drive grid
    uses `?thumb=320` so it no longer refetches full-resolution images. The
    full-resolution preview dialog still loads the original. No DB migration.

### Changed

- **Enriched the lode update-config surface** (FEAT-046, PLAN-098), ported from
  the sibling `zzci/access` fork (same vendored SDK). Extracted `lode.toml`
  parsing into a dedicated `apps/api/src/lode/config.ts` whose `readLodeConfig()`
  returns a status-carrying `LodeConfig`
  (`not_configured` / `unreadable` / `malformed` / `available`) with the
  non-secret fields `app`, `source` (+ `sourceType`), `asset`, `channel`,
  `policy`, `checkInterval`, `keepVersions`, `pin`, `requireSignature`
  (`[trust]`), and `runtime` / `runtimeVersion` (`[runtime]`). Manifest sources
  now surface the **host** (never the full URL); `[env]`, `[http].headers`, and
  `[trust].trusted_keys` are still never read. `/api/system/version` exposes this
  as `lode.config` (always present) in place of the previous optional
  `lode.updateConfig`, and the Settings → About tab renders the fuller config
  section with a present-but-unreadable notice.
- **Update system reworked onto the official lode SDK with admin operator
  controls** (FEAT-045, PLAN-097). Replaced the hand-rolled `apps/api/src/lode/`
  protocol code (`state`/`readiness`/`prepare`/`summary`/`types`) with the
  single-file SDK vendored from `dotns/lode@v0.0.10` (`sdk.ts`, `flock(2)`-
  serialised `state.json` writes) plus a thin glue `index.ts`. The admin
  Settings → About tab gains working **restart / update / rollback / hold**
  controls (update-available, config-changed, and maintenance-hold banners,
  rollout history, switch-to-version), backed by four audited admin endpoints
  `POST /api/system/lode/{restart,update,rollback,hold}` (409 when not under
  lode). `/api/system/version` now reports a richer lode summary (lastGood,
  hold, configChanged, history, rollbackTarget, updateAvailable), plus a safe,
  read-only slice of `lode.toml`'s `[update]` (policy / channel / asset / source)
  via the SDK's v0.0.10 `readConfig()` (`LODE_CONFIG`) — secrets such as the
  manifest URL, auth headers, and trusted keys are never surfaced.
- **lode v0.0.9 env-contract migration (breaking).** Upstream renamed the lode
  directory env/config key `LODE_DATA_DIR` / `data_dir` → `LODE_DIR` /
  `[global].dir` (no aliases). The app now resolves its data dir as
  `DATA_DIR > LODE_DIR > ROOT_DIR` and `deploy/lode.toml` uses `dir`; the
  deployed lode supervisor must be upgraded to v0.0.9 in lockstep.
- Raise the default per-file upload cap from 10 MiB to **200 MB**, and switch
  the env knob from bytes to MB for easier editing: `MAX_UPLOAD_BYTES` is
  replaced by `MAX_UPLOAD_MB` (default `200`), which `loadConfig` converts to
  the internal byte value. The Bun server's `maxRequestBodySize` derives from
  it, so it scales automatically; every downstream consumer keeps reading the
  derived `MAX_UPLOAD_BYTES` unchanged (FIX-047).

### Fixed
- Backup export now selects blob bytes per `files` row from its own
  `storage_driver` instead of the single active driver: local rows are packed
  (a missing disk file becomes a warning instead of failing the whole job), S3
  rows are summarised in one warning (back up the bucket directly), db rows
  travel inside the table NDJSON, and `file_blob` is registered in the file
  module backup contribution. Blob export is opt-in via a checkbox (default
  off); export warnings surface in the poll responses, the admin UI, and the
  CLI; NDJSON round-trips BLOB columns as base64 (FIX-053, PLAN-102).

- Paginate the S3 orphan sweep via the S3 continuation token so buckets with more
  than 1000 objects fully reclaim unconfirmed direct-upload blobs beyond the first
  page (FIX-050, PLAN-100).
- Stop the backup-staging sweep on shutdown and add a file-GC re-entrancy guard so
  overlapping sweeps cannot double-process (FIX-052, PLAN-100).

### Security

- **Drive direct-upload `confirm` no longer attaches another user's blob.** The
  confirm path now scopes blob deduplication to the uploader — matching the presign
  path — closing a cross-user file-disclosure IDOR where knowing a file's sha256 let
  an authenticated user attach and download it (FIX-048, PLAN-100; see
  `docs/audit/AUDIT-20260701.md`).
- Gate the auth rate-limiter's loopback exemption on `TRUST_PROXY` / non-production
  so a same-host reverse proxy over loopback no longer disables per-IP login
  throttling under the default `TRUST_PROXY=false` (FIX-049, PLAN-100).
- Use a length-independent constant-time comparison for the service token, validate
  client-side redirect targets on the denied / TOTP-verify screens, and pin all
  third-party GitHub Actions to verified commit SHAs (FIX-051, FIX-052, PLAN-100).

## v0.1.8 — 2026-06-22

### Added

- The drive sidebar gains a **Projects** section listing every project the
  current user can access; selecting one opens its file browser in the main
  pane, scoped to that project's drive entries. Frontend only — reuses the
  existing project-scoped drive APIs and the membership-filtered project list
  (FEAT-039, PLAN-091).

- The admin **Groups** tab now surfaces a built-in **Default** group alongside
  Administrators (FEAT-043, PLAN-095). It is the fallback for users in no group:
  its module grants define what an ungrouped user sees, and admins can edit them
  (modules only — the entry is system-owned, not renamable or deletable). The
  modules are stored under the `account.default_modules` setting (default empty,
  matching the previous zero-module floor) and exposed via admin-only
  `GET`/`PATCH /account/groups/default`. Semantics are **fallback, not
  additive**: a user placed in any group (even a grant-less one) leaves the
  Default group and sees only their groups' union, so an admin can tighten a
  specific user by group assignment.

- Global currency list managed in a new admin **Settings → General** tab: a
  read-only built-in set plus admin-added custom 3-letter codes (stored under
  the `app.currencies` setting). A non-admin `GET /currencies` endpoint serves
  the merged list so the procurement and HR forms reference one managed source.
  The Contact Categories section moves into this tab and the standalone Contact
  tab is removed. `THB` (Thai Baht) is added to the built-in list (FEAT-042,
  PLAN-094).

- Procurement create and edit now share one drawer form in the shared
  `ResizableDrawer`: item details (item name / title / supplier / category /
  quantity / amount / currency) are edited through an "edit details" form
  instead of inline per-field editing, and creation opens the same form in the
  drawer (the modal create dialog is removed). Workflow fields (status,
  priority, assignee, due date, tags, description) keep their issue-style inline
  click-to-edit in the detail view (FEAT-040, PLAN-092).

### Changed

- Procurement item details freeze once the record is confirmed: from `confirmed`
  onward (including `paid`, and when `cancelled`) the item-detail fields can no
  longer be modified — the "edit details" affordance is hidden and the API
  rejects such a PATCH with `409 PROCUREMENT_DETAILS_LOCKED`. They remain editable
  while the record is `requested` or `ordered` (FEAT-040, PLAN-092).
- Added new procurement statuses `paid` (已付款, after `confirmed`) and a reversal
  sub-flow `returned` (已退货) / `refunded` (已退款, after `accepted`) — the lifecycle
  is now requested → ordered → confirmed → paid → in_transit → received → accepted
  → returned → refunded (+ cancelled). `confirmed` is kept (not renamed). Returning
  is optional (accepted → returned → refunded, or received/accepted → refunded
  directly); received/accepted still cannot be `cancelled` and use return/refund as
  the reversal path. `paid` shows a solid primary chip; returned/refunded use
  destructive tints (FEAT-041, PLAN-093).
- Procurement status transitions are now constrained (previously free): once
  committed (`confirmed`/`paid` or later) the status can no longer return to
  `ordered`/`requested`, and a `received`/`accepted` order can no longer be
  `cancelled`. The status picker hides disallowed targets and the API rejects them
  with `409 PROCUREMENT_INVALID_TRANSITION` (FEAT-041, PLAN-093).
- The procurement currency field (free-text input) and the HR salary / payroll
  currency pickers (a hard-coded list) now offer the global currency list. Each
  picker unions in the record's own current code, so legacy 3-letter codes stay
  selectable; the stored `currency` columns and validators are unchanged
  (FEAT-042, PLAN-094).

### Removed

- Dropped the unused `HR_PAYROLL_CURRENCIES` web constant and the dead
  `procurement.default_currency` seed setting, both superseded by the global
  currency list (FEAT-042, PLAN-094).

## v0.1.7 — 2026-06-19

### Changed

- User identity is now keyed solely on the OAuth `sub`; on re-login the local
  `name` and `username` are no longer re-derived from the IdP token, so an
  upstream rename cannot desync the local row (FEAT-038, PLAN-089). `name` is
  locally editable for every user (real and virtual) and survives subsequent
  logins; only email/avatar/last-login still track upstream for real users.
- Virtual users can be created/edited with an explicit `email` (uniqueness-
  checked); setting it to a person's real address lets their first OAuth login
  bind to the virtual row in place — `isVirtual` is cleared, the OAuth identity
  attaches, and the local name/username plus all project memberships are kept.
  Binding requires a verified upstream email AND a matching username claim
  (`preferred_username` or `username`), falling back to email-only when the
  token carries no username claim. The admin Users page gains a name-edit dialog
  for real users and an email field (with binding hint) on the virtual-user
  dialog.

- Currency amounts are now entered and displayed as two-decimal major-unit
  values (e.g. `1,234.56`) while storage stays minor-unit integer (FEAT-037,
  PLAN-087). `formatMoney` renders two fraction digits over `value / 100`; a new
  reusable `MoneyInput` component (with `parseMoneyToMinor` / `minorToInput`
  helpers) backs the procurement amount, HR colleague salary, and HR payroll
  (base/bonus/deduction) inputs, replacing the integer-only fields that silently
  rejected or truncated decimals. Procurement seed amounts were rescaled to
  minor units to match the existing convention.

- OIDC login sessions now last `SESSION_MAX_AGE` (default 24h) instead of the
  IdP access-token TTL (FIX-046, PLAN-090). Previously the server session row
  was keyed to the access token's `expires_in`, so a short-lived access token
  (commonly ~1h) forced re-authentication even though the cookie was good for a
  day. The session now tracks two independent clocks: a ceiling
  (`createdAt + SESSION_MAX_AGE`) and the access-token expiry
  (`access_token_expires_at`, new nullable column, migration 0003). An expired
  access token is refreshed in the background when a refresh token is present;
  with no refresh token (or on refresh failure) the user stays logged in until
  the ceiling rather than being torn down. The authorize request now requests
  the `offline_access` scope so cooperating IdPs issue a refresh token.

### Added

- Unified file/drive upload UX (UI-027, PLAN-088). The upload-queue panel moved
  to `shared/components/file` and is now mounted once in the app layout, so
  upload progress shows on every surface instead of only the drive page;
  same-folder uploads are grouped under a folder header with a file count and
  aggregate progress alongside an overall summary. A new
  `POST /:id/attachments/from-drive` endpoint (documents, issues, procurements,
  HR) attaches an already-stored drive file by registering a new
  `file_reference` to its blob (refcount bump, no re-upload), after an
  authoritative server-side READ check on the drive entry. A "Choose from Drive"
  button in resource attachment areas drives it via the existing drive file
  picker.

- Personal Access Tokens for API/CLI/AI-agent access (FEAT-034, PLAN-084).
  Users mint a `bithk_pat_…` bearer in **Settings → API tokens**; admins can
  mint one for any user (including virtual users) from **Admin → Users**. A
  token authenticates as its owner via a chained auth provider (cookie first,
  then bearer) and is bounded by a required expiry and a per-module scope
  (`read` / `write`, three levels incl. none) enforced as an intersection on
  top of the owner's own permissions — independent of the admin short-circuit,
  so an admin's token is still scope-limited. Secrets are shown once and stored
  as a SHA-256 hash; token-management routes are session-only. Ships a
  repository-local `skills/bithk` skill that teaches an AI agent to
  drive the full API with such a token (create work orders, upload files, all
  modules). See [decision 013](decisions/013-personal-access-token-scope.md).

- HR colleague standing monthly salary (`salary_amount` + `salary_currency`,
  both nullable) and one-click payroll generation (FEAT-036, UI-026, PLAN-086).
  `POST /hr/payroll/generate` (admin-only, idempotent) inserts a pending record
  for each active colleague that has a salary set and no record for the
  `YYYY-MM` period, returning `{ created, skipped }`. The payroll list now
  carries `meta.totals` — net summed per currency over the entire filtered set
  — surfaced on the page as a per-currency summary with thousands-separated
  money (new `formatMoney` helper). The Approvals page gains application /
  decision timestamps and a full reason + decision-note detail view; the
  colleague form gains a Salary section.

### Changed

- HR governance is now admin-only (FEAT-036): deciding an approval
  (`POST /hr/approvals/:id/decision`), generating payroll
  (`POST /hr/payroll/generate`), and marking a payroll record paid
  (`PATCH /hr/payroll/:id` with `status:"paid"`) each require admin; ordinary
  field edits stay module-gated, so a non-admin with the `hr` module keeps read
  and non-governance edits but gets 403 on these. The approvals list is now
  ordered newest-first.

### Fixed

- `gen-api-docs` now mounts the ship, search, and worklist routers, so
  `docs/reference/api-routes.md` covers the full protected surface (306 routes,
  was 265 — those modules were silently missing) (FIX-045).

## v0.1.6 — 2026-06-16

### Changed

- Realign the lode upgrade integration with the breaking `lode/v1` spec
  (FIX-040). The release manifest and `deploy/lode.toml` drop the removed
  `entry` field and launch via `run = "bun index.js"` / `exec = "bun run"`;
  the manifest also drops `min_lode`, and the release workflow validates the
  new asset shape. Readiness now follows lode's `state.ready =
  {LODE_INSTANCE}-{phase}` convention: the app reports serving (`-0`) only
  after a DB probe, handles lode's staged-update prompt (`-1`) by
  checkpointing the WAL and flushing logs before acking (`-2`), and the
  `/system/version` summary reports the handshake phase. A finite
  `[supervise].prepare_timeout` backstops the handshake. The integration is
  extracted from `lode-state.ts` into a reusable `apps/api/src/lode/` module
  decoupled from app internals via injected probe/prepare callbacks.

- Groups absorb global roles (FEAT-032): one grouping concept. The
  `global_roles` entity and `users.global_role_id` are removed; groups gain
  optional module grants and a non-admin user's visible modules are the
  UNION over their groups (no grants → no modules, the visibility floor).
  Admins keep the `users.role` bypass and appear as a built-in
  "Administrators" entry on the Groups tab (add = promote, remove =
  demote, last-admin guard intact). The Roles page/nav is deleted; the
  group create/edit dialog gains a module switch table; seed grants the
  classic five modules through an "All Staff" group (plus `hr` via Fleet
  Operations). Supersedes the FEAT-031 roles surface.

### Added

- Backup CLI import/export (FEAT-033 / PLAN-083): two offline subcommands on
  the packaged binary drive the backup v2 services without a running server.
  `backup:export <out>` writes a v2 archive (`--modules` XOR `--exclude` at
  module level with transitive deps auto-resolved and excluded-but-pulled-back
  deps warned, `--no-blobs`, `--redacted`); `backup:import <archive>` applies it
  (`--mode merge|replace` default `merge`, `--include-users`, `--actor-id`, where
  `replace --include-users` requires `--actor-id` to be an active admin present
  in the backup). Both run against a new `wireRuntime` offline runtime (open,
  migrated DB + file driver, no cron / sweeps / HTTP server) and reuse
  `writeArchiveV2` / `prepareImport` / `startImportApply`; backup-service imports
  stay dynamic so the boot path is unchanged. A live e2e test
  (`tests/e2e/modules/backup/cli-roundtrip.test.ts`) locks the export → import
  round-trip.

- HR colleague detail drawer + profile metadata & documents (FEAT-030): the
  colleagues sub-module opens the shared `ResizableDrawer` for create / view /
  edit (the standalone dialog is gone). Colleague records gain profile fields —
  birthday, hire / probation-end / contract-end dates, gender, employment type,
  nationality, phone, email, address, work location, a free-form `payment_info`
  list (one DB column, custom label/value rows per country), and repeatable
  `emergency_contacts` — plus a personal-document area that uploads multiple
  files (passport, certificates, …) through the file module's generic
  attachment registry (`owner_type` `hr_colleague_document`, no new table).

- Global roles as user groups (FEAT-031): the admin Roles page is now a
  two-column group surface — role rows with member-count badges on the left
  (the synthetic **Administrators** entry backed by `users.role`, the locked
  zero-module **Guest** default, then custom roles), the selected role's
  members on the right with debounced search-add and remove. Adding to
  Administrators promotes (`role: "admin"`); removing demotes; removing from
  a custom role falls the user back to Guest. Role permissions (name +
  module switches) edit in a dialog; Admin/Guest open read-only.
  `GET /global-roles` carries `userCount`; `GET /account/users` gains a
  `global_role_id` filter; a last-admin guard (409 `LAST_ADMIN`, counted
  inside the mutation transaction) blocks demoting/disabling the last active
  admin. The boot backfill demotes a legacy module-carrying "Member" default
  in place to a custom role and inserts the Guest floor; seed now creates a
  custom "Member" role and assigns seeded users to it. The admin Users page
  no longer mutates roles at all: the promote/demote action and the per-row
  role select are gone (role membership is managed solely on the Roles
  page); its role column is a display-only badge.

- HTTP access log filtering (FEAT-029): new `HTTP_LOG_LEVEL` env var
  (`debug | info | silent`, default `info`) sets the level of the
  per-request "request completed" line for 2xx/3xx responses — `debug`
  hides them under the default `LOG_LEVEL=info`, `silent` drops them.
  Failure responses always log regardless: 5xx at `error`, 4xx at `warn`
  (previously every request logged at `info`). The unhandled-error log
  line now carries `requestId`, `method`, and `path` so a user-reported
  `X-Request-Id` can be matched to its stack trace.

- Sidebar feedback button (FEAT-028): a footer entry above the user menu opens
  the anonymous Tally form `jaEZP1` as a popup (official embed widget loaded
  from `index.html`); when the widget script is unavailable the button falls
  back to opening the form in a new tab, so feedback keeps working while the
  app itself is erroring. CSP `script-src`/`frame-src` now allow
  `https://tally.so`.

### Changed

- HR module page top now matches the other top-level modules (UI-025): the
  `/hr` layout renders the shared `PageHeader` (HR title + description) above
  an underline tab nav styled like the project detail page, and the
  colleagues/approvals/payroll sub-pages drop their redundant per-tab
  headings.

### Fixed

- Cover and avatar images now display under a base-path deployment (FIX-043).
  The server built the `<img>` URLs for project/ship covers and contact avatars
  as a bare `/api/files/...`, omitting `BASE_PATH`; under `BASE_PATH=/app` (the
  documented production layout) the API lives at `/app/api`, so those images
  404'd while `fetch()` calls (which prepend the base) worked. The URLs now
  carry the configured base path via a shared `fileInlineContentUrl` helper set
  at `initFileModule`. Dev / root deploys (`BASE_PATH=""`) are unchanged.

- Backup now covers two tables it silently dropped (FIX-042):
  `global_procurement_categories` (the global procurement vocabulary — its
  sibling `global_equipment_categories` was already backed up) and
  `document_pins` (per-user pinned documents). A new CLI round-trip e2e seeds
  the full dataset and asserts every table except intentional log / transient /
  security state round-trips with no row loss, so future coverage gaps fail CI.

- Backup import no longer rejects the empty-string id sentinel (FIX-041): the
  import id-shape validator (`assertIdShape`) treated `""` on `*Id` fields as a
  bad format, so any backup containing a root `drive_entries` row
  (`parent_entry_id = ""`) failed with `Invalid id format on field
  parentEntryId`. Empty strings are now treated as "no reference", restoring
  full real-data round-trips. The CLI round-trip e2e gains a root drive entry to
  lock the regression.

- App display branding now loads from server runtime settings through
  `/api/system/branding`, seeded by `APP_DISPLAY_NAME`, so packaged installs
  can update the title and visible brand labels without rebuilding the web
  bundle (FIX-039).

- Production OAuth callback no longer throws while clearing the
  `__Secure-oauth_state` cookie. The cleanup now uses the configured cookie
  path and includes the `Secure` attribute required for `__Secure-` cookies
  (FIX-038).

### Added

- Global roles with per-module visibility (FEAT-024 / PLAN-076): named
  `global_roles` grant non-admin users a set of main-area modules
  (documents, drive, projects, ships, contacts, hr); admins bypass. A boot
  backfill seeds the undeletable system default "Member" role with every
  module except `hr`, and `users.global_role_id` (`NULL` → default role)
  keeps existing users on exactly their pre-rollout visibility. A module
  gate on the protected router answers hidden-module requests with the
  fail-closed 404 of decision 003 (with a route-prefix coverage test);
  `/account/me` returns the resolved `modules` list, which filters the
  sidebar, command palette, deep links (redirect to `/overview`), and
  global search domains. Admin Roles page (`/admin/roles`) with a module
  checkbox editor plus a global-role select on the users page; en + zh
  i18n. New modules register one `MODULES` entry and one nav `module` key
  to become role-grantable.

- HR approvals and payroll sub-modules (FEAT-026 / FEAT-027 / PLAN-078):
  the two placeholder tabs under HR are now working modules; access is
  owned by the module visibility gate (`hr` module key, PLAN-076), so they
  stay effectively admin-only until a role is granted `hr`.
  Approvals: requests (leave/overtime/business trip/other)
  filed for a colleague with a one-way pending → approved/rejected
  decision flow (decider + time + note stamped; decided records immutable).
  Payroll: one record per colleague per `YYYY-MM` period with
  multi-currency amounts (integer minor units, 3-letter code validated by
  format), a server-computed non-negative net amount, and a one-way
  pending → paid transition (paid records immutable). Two new tables
  (`hr_approvals`, `hr_payroll_records`) via Drizzle migration, backup
  contribution extended, list pages with filters and dialogs, en/zh i18n,
  focused API route and frontend tests.

- Finance colleagues module (FEAT-021 / PLAN-073): admin-only registry of
  internal finance actors at `/finance/colleagues`. Each colleague links to
  exactly one existing active `users` row (real or virtual) via
  `finance_colleagues.user_id` (`NOT NULL UNIQUE`, `ON DELETE RESTRICT`);
  DELETE archives (`status='archived'`) instead of hard-deleting. Ships list
  search/status filters, create/edit dialog with the assignable-users picker,
  a virtual-user badge, sidebar nav, i18n, and a backup contribution that
  restores `users` before colleagues.

- Backup module v2 (FEAT-023 / PLAN-075): staged `.tar.gz` export jobs
  (manifest + per-table NDJSON + content-addressed blobs) with a
  separate-blob mode, cross-schema **merge** import with column-level
  mapping, per-module transform hooks, and an exact rollback dry-run
  (v1 delete-then-insert survives as explicit `replace` mode), standalone
  blob restore for separate-mode archives, an admin Settings Backup tab
  (en + zh), and service-token route parity (always-redacted archives,
  fail-closed module scope, bucket-scoped job visibility). The v1 JSON
  routes are deprecated — kept for one release with their replacement
  mapping documented in `docs/modules/backup.md`.

- Admin Settings About tab (FEAT-022 / PLAN-074): admins can view build
  version, commit, build time, and a sanitized lode status/update summary from
  `/api/system/version`. The surface exposes refresh/status only and omits
  secrets, trust keys, headers, raw config, and sensitive filesystem paths.

- lode-managed release packaging (REFACTOR-027 / PLAN-070): `bun run package`
  now emits a lode-compatible `tar.gz` asset, `dist/manifest.json`, and
  `dist/checksums.txt`. The asset contains the API bundle, built SPA,
  and Drizzle migrations. Added `deploy/lode.toml` as the operator-side template and changed the
  Docker image into a generic `dotns/lode` + Bun runtime. The release workflow
  now runs from GitHub Release publish events, can be manually rerun for an
  existing release tag, and uploads the selected lode tarball, `manifest.json`,
  and `checksums.txt`. The lode artifact is now flattened around root
  `index.js`, `dist/`, and `drizzle/`, and CI no longer runs the private-repo
  CodeQL job that cannot upload code-scanning results without GHAS.

- Per-module project role permissions (FEAT-017 / PLAN-042): project roles now
  carry 12 per-module capabilities — `issue.view/comment/manage`,
  `procurement.view/comment/manage`, `files.view/manage`, plus the project-level
  `categories.manage`, `members.manage`, `roles.manage`, `project.manage`. Two
  implicit, undeletable system roles bracket every project: **Owner** (all caps)
  and **Guest** (empty / no-permission fallback). Deleting a custom role now
  auto-reassigns its members to Guest instead of erroring. Seeded editable
  presets **Reader** (all `*.view`), **Commenter** (+`*.comment`), and **Writer**
  (+`*.manage` + `categories.manage`) give GitHub-style read / comment /
  read-write tiers; custom roles may mix per-module freely. Issue, procurement
  comment, and project-file drive routes are now gated on the matching
  capability (non-members still blocked); the Roles UI gains per-module
  capability groups, a preset quick-fill, and locked Owner/Guest rendering.

- Project and ship cover images (FEAT-011 / FEAT-012 / FEAT-013): upload,
  replace, and remove a cover through the file module (`POST`/`DELETE
  /api/projects/:id/cover-image` and `/api/ships/:shortId/cover-image`), stored
  as `project_cover` / `ship_cover` file references and shown on list cards and
  detail headers. A project that is a ship's base project inherits the ship's
  cover when it has none of its own. Projects and ships without a cover render a
  default placeholder illustration (FEAT-014).

- Full-feature static seed dataset (CHORE-003 / PLAN-041, supersedes the
  PRNG seed from CHORE-001 / PLAN-020): `bun run seed` resets the database and
  imports a curated static dataset from `apps/api/scripts/seed/data/*.json`
  through the real service-layer creators, with demo files committed under
  `apps/api/scripts/seed/assets/` so covers and attachments are stable and work
  offline. Coverage spans every module: 15 accounts + 3 groups, 11 contacts,
  22 real-world yachts (5–50 m) with equipment and global/ship maintenance
  templates, 8 standalone projects (members, categories, tags, covers, ship
  binding) plus ship base projects, ~64 work-order issues across all five
  statuses with tags, comments (some internal) and attachments, ~300
  procurements (10 per project) with suppliers/categories/attachments,
  documents (tree, tags, pins, attachments, public links + collaborator
  grants), drive (personal + team directories with members, folders, uploaded
  and text files, an extra version, and direct/public_link shares), audit
  events, cron jobs with run logs, and settings. Cross-record links use stable
  keys resolved by the importer; adding a schema field later means editing the
  JSON object only.
- Drive file manager completion pass (FEAT-010 / PLAN-014): recursive folder
  upload from the browser, direct drag-and-drop moves, explicit current-folder
  versus drive-wide search, image thumbnails in grid view, and a version
  history dialog reachable from item actions and preview with switch-current
  support. Embedded project and ship file tabs can now hide the shared file
  browser title and search controls.
- Global contact module (REFACTOR-003 / PLAN-013): owner/viewer authorization,
  private/public visibility, confidential field masking, tag classification
  through the global tag vocabulary, explicit per-user/group viewer grants, the
  `/api/contacts` API, and the `/contacts` web page.
- Ship management module (FEAT-009 / PLAN-011): admin ship creation with an
  auto-created base project, base-project-anchored permissions, ship list/detail
  UI, project binding, Equipment and Maintenance tabs, equipment CRUD,
  ship-level maintenance-template management, admin global-template knowledge
  base with copy-to-ship, maintenance work orders backed by project issues plus
  `issue_references`, inline checklist/precautions rendering with dangling-ref
  fallback, and ship files via the base project's drive FileBrowser. Added
  EN/ZH i18n, focused frontend/API tests, and a live e2e main-flow suite.

### Changed

- The finance module is renamed to HR (FEAT-025 / PLAN-077): colleagues are
  an HR concern, so the backend module, `/finance/colleagues` routes, the
  `finance_colleagues` table (Drizzle rename migration, data preserved), the
  backup contribution, the web routes, the sidebar entry, and the i18n
  namespace all moved from `finance*` to `hr*`. The new `/hr` layout owns the
  admin guard and a tab nav; Approvals and Payroll tabs are pre-mounted as
  placeholder pages with no functionality. Backup archives exported under the
  old `finance` module name do not map to the renamed contribution.
- Mutable app paths now resolve from `DATA_DIR` when set, with
  `${LODE_DATA_DIR}/data` as the lode fallback. The Docker and compose examples
  use a single `/srv/lode` persistent volume for lode state, downloaded
  versions, and app data.
- lode integration now follows the upstream Bun app contract: `deploy/lode.toml`
  uses GitHub Releases source, `run = "bun"`, `exec = "bun run"`, and
  `readiness = "state"`; the API writes `state.ready = LODE_INSTANCE` after
  startup.

- Reworked the shared `ListFilter` into a Google-Drive-style filter bar where
  each dimension is its own independent dropdown (REFACTOR-018 / PLAN-055).
  Selecting a single-select value highlights that dropdown, swaps its trigger
  label to the chosen value, and adds a connected × button; multi-select
  dimensions surface each chosen value as its own removable chip; a trailing
  "Clear filters" button resets every dimension at once. Removed the previous
  aggregated single-"Filter" dropdown and the always-visible "resident" toggle
  chips. The drive file/share filter bar (`DriveFilterBar`) and the procurement
  tag filter now both render through `ListFilter`; the standalone
  `ProjectTagFilter` (and its `-project-tag-filter.fit` measurement helper) were
  deleted. Resolves the filter-control fragmentation flagged in the UI
  consistency audit (P4).

- Unified all interactive buttons onto one app-wide sizing standard: non-icon
  buttons use the `Button` default size (`h-8`) and icon-only buttons use
  `size="icon"` (`size-8`), replacing scattered `size="sm"` / `size="lg"` /
  `size="icon-sm"` / `size="icon-lg"` variants and ad-hoc `h-7` / `h-9` / `h-10`
  / `size-7` / `size-9` height overrides; a bounded `xs` / `icon-xs` (`size-6`)
  exception remains for tiny inline affordances. Form fields (`Input`,
  `SelectTrigger`) and `Badge` components are out of scope. The project
  tag-filter is capped to 7 inline tags. Recorded as
  [decision 007](decisions/007-button-sizing-standard.md).

- Tags unified into the central tag module (REFACTOR-009 / PLAN-043): no module
  owns a tag join table anymore. `tags.source_type` was renamed to `tags.type`
  (`sourceType` -> `type`, `TAG_SOURCE_TYPES` -> `TAG_TYPES`, `TagSourceType` ->
  `TagType`; values unchanged: `project / contact / document / issue /
  procurement`), and a single generic `tags_refs(resource_id, tag_id)` table in
  the tag module now backs every domain — PK `(resource_id, tag_id)`, index on
  `tag_id`, `tag_id` FK -> `tags.id` `ON DELETE CASCADE`, no FK on `resource_id`
  (the source type is derived from the joined tag row). `ResourceTagBinding`
  collapses to `{ type }` over the shared table behind the source registry, so
  the tag module still imports no domain schema. Each domain cleans up its
  `tags_refs` rows on resource delete at the application level. Breaking schema
  change (dev stage, no data migration; DB reset). Recorded as
  [decision 006](decisions/006-unify-tags-into-tag-module.md).

- Issue status enum normalized to `todo / working / review / done / cancel`
  (REFACTOR-008): replaces the former `open / in_progress / done / cancelled`
  across the API (`IssueStatus`, the create/update zod enums, `createIssue`
  default `todo`) and the web (types, status colors, the work-order list groups
  + the new `review` group, the detail status select, ship maintenance-order
  badges, and en/zh labels). A data migration
  (`0003_normalize_issue_status.sql`, `type='issue'` scoped so procurement keeps
  its own `cancelled`) rewrites existing rows on startup: open→todo,
  in_progress→working, cancelled→cancel.

- Project code is now lowercase and immutable after creation (UI-021 /
  PLAN-034): the backend generates/normalizes the code in lowercase and the
  update API no longer accepts `code`. The editable code field was removed from
  the project settings General form; the code is shown read-only at the bottom
  of the settings dialog left sidebar with a copy control.

- Project issues aligned with the access issue reference (REFACTOR-006 /
  PLAN-032): the project work-order module now mirrors the `/app/zzci/access`
  issue baseline for CRUD, permissions, audit events, comments, and attachments
  (including comment attachments and inline-safe `?inline` downloads). Project
  ownership remains the one core product delta — issues stay nested under
  `/api/projects/:projectId/issues` with project-member assignment and a
  fail-closed membership gate — and the BITHK-only extras (pin/unpin, issue
  references + ship maintenance-orders, command-palette search) plus the
  Linear-style grouped work-order list are kept as intentional deltas, not
  parity gaps. Adds project-scoped e2e coverage (CRUD, membership gate,
  attachment + comment-attachment lifecycles, inline download) and documents the
  model in `docs/modules/issue.md`.
- Tag abstraction consolidated into one module (REFACTOR-005 / PLAN-031): a
  dedicated `tag` module now owns the tag vocabulary, source-type validation,
  the create / rename / delete / list APIs, the `/api/tags` routes (behind a
  source registry so the tag module imports no domain schema), and reusable
  assignment helpers. The central `tags` table is type-scoped — unique per
  `(source_type, name)` over `project` / `contact` / `document` — and the
  project, contact, and document services were migrated onto the shared helpers
  and their `project_tags` / `contact_tags` / `document_tags` joins. The tag
  vocabulary is no longer "project-owned" or globally unique.

- Issue detail backend parity (FIX-006 / PLAN-027): current project-scoped
  issue details were compared against the original global issue details from
  `/app/zzci/access`. No non-UI behavior gap was found; focused API tests now
  lock project-scoped detail comments, attachments, and fail-closed non-member
  access without changing frontend UI.

- Project overview list polish (UI-019 / PLAN-028): the pinned-items, latest
  work-order, and latest-procurement cards now share one row rhythm — title
  first, then a wrapping metadata line (kind/status badges and date) that stays
  aligned and reflows on narrow screens. Loading and empty states render as
  intentional centred muted blocks instead of loose body text. Data hooks,
  permission gating, pinned behaviour, and tab navigation are unchanged.

- Project overview metadata simplification (UI-017 / PLAN-025): creator, last
  updated, tags, and description now read as one unified project information
  card, and the right-side work-order / procurement summary metric tiles are
  gone. Pinned work and the latest work-order / procurement list cards are
  unchanged.

- Global typed tag vocabulary (FEAT-015 / PLAN-023): the shared `tags` table
  moved out of the project module into `@/modules/tag` and gained a
  `source_type` discriminator (`project` / `contact` / `document`) with
  uniqueness scoped to `(source_type, name)`. Project, contact, and document
  tags now have independent namespaces, so the same word can exist as a project
  tag and a contact tag without colliding; duplicates are rejected only within
  one source type. Document tags became first-class rows through a new
  `document_tags` join over the typed vocabulary instead of the legacy
  `document_details.tags` JSON column. The document API response keeps its
  JSON-string `tags` shape, so the frontend contract is unchanged. The admin
  `/api/tags` endpoints accept an optional `type` (`project` by default) to
  list, create, rename, and delete any typed vocabulary. Breaking: the `tags`
  table schema changed and `tags.name` is no longer globally unique.

- Project overview page polish (UI-015 / PLAN-022): the overview tab now uses a
  restrained card-based dashboard with summary metrics, clearer description,
  pinned work, and recent activity groups. Rows use a responsive two-line
  structure so titles, status badges, and dates remain scannable on narrow
  screens.

- Project work-order list redesign (UI-016 / PLAN-024): the project issues tab
  now removes top status filters and view switching in favor of compact
  status-grouped lists with visible counts. The toolbar keeps search and create,
  while rows preserve detail navigation, pinning, priority, assignee, and due
  date metadata with responsive wrapping.
- Project work-order grouped-list refinement (UI-018 / PLAN-026): work-order
  status groups are collapsible, empty groups are hidden, cancelled appears only
  when populated, and rows now use a lighter single-line order of title,
  priority, assignee, and due date. Search moved to a compact header trigger
  beside settings, while create and priority filtering remain in the tab
  toolbar. The create dialog is wider, gives description more room, opens the
  native due-date picker directly from the field, and includes a supported-status
  selector with restrained semantic cues.

- Create-project dialog reworked to a Linear-style layout (UI-012): a borderless
  title and description, an existing-tag combobox sourced from the global tag
  vocabulary (with inline tag creation), and no manual code or status fields —
  the backend auto-generates the code and defaults the status to active.

- Project module UI deduplication (UI-011): the project detail overview tab no
  longer repeats the header's key information (status, code, creator, updated)
  and tags cards — it keeps description, procurement category preview, and the
  member preview. The work order tab drops the status summary StatStrip that
  duplicated the status filter chips. Project list cards add an admin-only
  settings entry that deep-links into the project settings dialog via a
  `settings` search param.

### Removed

- Single Bun executable packaging via `scripts/compile.ts`. Static assets and
  Drizzle migrations are no longer embedded through temporary source rewrites;
  packaged releases ship them as regular files.

- The five per-domain tag join tables `project_tags`, `contact_tags`,
  `issue_tags`, `document_tags`, and `procurement_tags` (REFACTOR-009 /
  PLAN-043): all tag assignments now live in the single `tags_refs` table owned
  by the tag module. No data migration; the dev DB is reset.

- The legacy `document_details.tags` JSON column (REFACTOR-005 / PLAN-031):
  document tags now live solely in the `document_tags` join over the shared
  typed `tags` vocabulary; the document row still exposes `tags` as a JSON
  string array sourced from that join.

- The ship lifecycle concept (REFACTOR-004): ships had two parallel state
  fields — `status` (active/archived) and `lifecycleStage`
  (design…decommissioned). A fleet has no lifecycle, only a status, so
  `lifecycle_stage` is dropped from the `ships` table (migration 0008) along
  with the lifecycle enum, badge, overview stepper, and form field. The ship
  list now filters by status (All / Active / Archived) and cards/headers show
  the status badge.

- Project list cards no longer render the redundant status/updated grid block
  (UI-011); the status badge and the date line in the card header already carry
  that information.

### Fixed

- The project list settings entry now opens the settings dialog in place over
  the list (FIX-005) instead of navigating into the project detail page, so
  closing it leaves the user on the list.

- Single-user sessions are now reused when opening a new tab (FIX-004 /
  PLAN-015): the root route enters the authenticated app guard instead of
  forcing `/login`, and the login page checks the existing `/account/me`
  session before rendering the password form.
- Drive code/text preview now fills its container (FIX-001): the CodeMirror
  host spans 100% width/height and the dialog body drops its padding for the
  `text` kind, so the editor is flush instead of inset with empty margins.
  Markdown editing gets the same flush treatment — the body drops its padding
  while editing and the old asymmetric negative-margin hack is removed (the
  read-only prose preview keeps its comfortable inset). The dialog also swaps
  the floating (centered, bordered-box) toolbar for a docked full-width bar so
  it sits flush under the header, and the markdown source view (CodeMirror)
  drops its content top padding so the first line meets the toolbar without a
  gap.

### Changed

- Unified the app onto one global semantic color system (UI-010): `index.css`
  gains dual-channel `success`/`warning`/`info` plus `accent-design`/
  `accent-maint` tokens (blue `primary` unchanged), and `chart-1..5` were
  refreshed to the shadcn official multi-hue palette. Cross-module status colors
  now live in `shared/lib/status-colors.ts`; ship drops its hard-coded Tailwind
  palette classes, and projects (status + issue badges) and contacts (visibility
  + confidential) move off neutral-gray badges onto the shared tokens, so the
  same status reads the same color everywhere. Recorded as decision 005 (local
  extension to base-nova).
- Ship detail page given a semantic color system (UI-009): a single
  `-ship-colors.ts` map assigns each lifecycle stage its own hue (design violet,
  building amber, sea-trial cyan, in-service emerald, maintenance indigo,
  decommissioned slate) plus status-colored chips, consumed through a shared
  `LifecycleBadge`/`ShipStatusBadge` and reused across the hero, overview,
  profile, and ship list. The overview quick-stats and hero metrics gained
  colored icon tiles, the lifecycle stepper colors each stage (done/current/
  future states), upcoming-maintenance rows show a colored icon and a
  status-colored badge, bound projects show status + base badges, and equipment
  categories render proportional bars. Tailwind built-in palettes only — no
  global theme tokens changed.
- Ships, projects, and contacts modules normalized to the shared shadcn
  (base-nova) baseline (UI-008 / PLAN-021) so they match the rest of the app:
  removed the redundant `rounded-2xl bg-background` page wrapper and the
  decorative ship illustrations, rebuilt the ships list card on the same `Card`
  pattern as the projects list, and replaced hand-rolled `bg-card` surfaces
  (with `ring-foreground/5` / `shadow-sm` / bespoke radii) with the canonical
  `Card` component and `rounded-lg border` table wrappers. Behavior, data,
  routing, and i18n are unchanged.
- Issue (work order) detail panel redesigned toward a calm, zen-mode reading
  layout (UI-003 / PLAN-018): a thin action bar, status/priority chips above a
  large title, a quiet four-field meta grid (assignee / due date / creator /
  created) with an aligned "updated" line, and a spacious description block over
  the existing comments + attachments footer. The single shared
  `ProjectIssuePanel` still backs both the drawer and the fullscreen route, so
  the new look applies everywhere an issue opens with no duplicated changes; the
  fullscreen variant centers content in a constrained column and the drawer was
  widened to `max-w-2xl`. Behavior, permissions, inline editing, and routes are
  unchanged.
- Project list toolbar now matches the ships list pattern (UI-005): tag/status
  filters stay on the left, project search sits on the right, and the
  grid/list view-mode switch was removed so the page renders card-grid only.
- Removed the top KPI/meta stat blocks from the projects and ships list pages
  (UI-006), while keeping filters, search, pagination, and create actions.
- Removed the top KPI/meta summary chips from the contacts list page (UI-007),
  while keeping search, filters, tag filtering, creation, and table behavior.
- Procurement suppliers now reference the global contacts directory. A
  procurement `supplier_id` may point at any existing contact and is no longer
  project-scoped or constrained by a supplier type enum.
- Unified the drive `text` surface on CodeMirror 6 (FIX-001): both preview and
  editing now use CodeMirror (grammar resolved from the filename via the shared
  `loadLanguageExtension` helper; unmatched files render as plain text),
  replacing the plain `<textarea>` editor and the `<pre>` fallback. Only
  `markdown` keeps its dedicated Milkdown surface. Dropped the now-unused
  `LANGUAGE_BY_EXTENSION` routing map.

- Aligned `docs/modules/` with the current code (DOCS-001): added the missing
  `search` and `share` module pages (and the README index rows), rewrote
  `issue.md` for the project-only model, corrected procurement category and
  capability documentation, documented document pinning + `document_pins`,
  repointed document/drive sharing to the unified share module, dropped drive's
  removed `drive_file_shares` table / public routes, and fixed `cron`
  (`lastStatus` / `taskType` filters), `item` (synchronous
  comment-attachment release), and `account` (DEFAULT_ADMIN promotion gated on
  "no admin", not "no users").
- Drive file preview now highlights code/text with CodeMirror 6 (reusing the
  stack already bundled for the Milkdown source view) instead of shiki.
  Grammars load on demand via `@codemirror/language-data`, dropping shiki's
  per-language TextMate chunks (e.g. `cpp` ~626 kB) and its ~622 kB oniguruma
  wasm from the build entirely.
- Fixed an ineffective dynamic import in the file preview dialog that
  statically pulled the markdown preview into the dialog chunk; the read-only
  path now reuses the lazy `MarkdownEditor`, shrinking the main entry chunk
  from ~472 kB to ~143 kB. The build no longer emits any `>500 kB` chunk or
  ineffective-dynamic-import warnings.
- Full-feature integration test pass across all modules. Re-pointed the
  stale live-stack e2e suites at the current API surface: issue CRUD /
  comments / attachments moved to the project-scoped
  `/api/projects/:projectId/issues[...]` routes, and drive sharing moved
  to the unified share module (`/api/shares/:type/:id`,
  `/api/shares/{received,sent,links}`, `/api/shares/:shareId`,
  public `/api/shared/:token[/download]`). Updated drive read assertions to
  the fail-closed 404 existence policy (no-relationship reads → 404). Added
  a live-stack `search` e2e module (global search + auth gate). Raised the
  `apps/web` vitest coverage floors from 14/12/14/10 to 29/29/29/24
  (statements/functions/lines/branches) to lock in the F1–F3 UI-suite gains.
  `bun run check` and `bun run test:e2e` (75 tests) both green. See
  [full-feature test report](task/full-feature-test-report.md).
- Issues are now a project-only sub-module — there is no global / personal
  issue. Every issue belongs to a project (`issue_details.project_id` is now
  `NOT NULL`) and is assigned to a `project_members.id`. All issue endpoints
  moved under `/projects/:projectId/issues[...]` (list, create, detail,
  update, delete, attachments, comments), gated by project membership +
  `resolveProjectIssueAccess`; the global `/issues*` routes were removed.
  The full issue detail panel (inline edit, status/priority/assignee, due
  date, comments, attachments, delete) is reachable via two routes: a drawer
  overlay nested under the project page
  (`/projects/$projectId/issues/$issueId`, the project detail stays mounted
  underneath) and a standalone fullscreen page
  (`/projects/$projectId/issues/$issueId/full`) reached via the drawer's
  maximize action or a deep link. Global search still surfaces
  issues but deep-links into the owning project and scopes to the projects a
  user belongs to (admins: all). Removed the global Issues sidebar entry.
  Breaking schema change (dev-stage, no data). See REFACTOR-002 / PLAN-009.

### Removed

- Removed the `project_contacts` table, project-scoped contacts UI/API, and
  `contacts.manage` project capability. Contact ownership and sharing now live
  in the global contact module.

### Added

- Project module overhaul (settings hub): configurable per-project **roles**
  (`project_roles` + a capability set; route gates check capabilities, not role
  names; a seeded undeletable "Project Manager" role guards against lock-out),
  a per-project external contact directory that was later replaced by the
  global contact module, **procurement categories** (`procurement_categories` +
  `category_id` on procurement, with category filtering), and user-defined
  **tags** (`tags` + `project_tags`, many-to-many).
  The project itself keeps only basic fields — name, code, description, status
  (`active` / `archived`), and tags. `project_members` is operator-only — real
  users or **virtual** users (own staff without a login account), carrying a
  `title` — and drops the old `member_type` / supplier columns; assignment
  targets stay `project_members.id`. Procurement visibility/mutation moved to
  the `procurement.view` / `procurement.manage` capabilities. Web: the project
  list is a card grid with a single mutually-exclusive chip filter (`All` /
  `Archived` / each tag; archived projects are hidden until the chip is picked),
  a tabbed **Project Settings** dialog hosts General / Members & Roles /
  Contacts / Procurement Categories (the standalone Members tab is gone), and
  procurement forms pick supplier + category from the new directories. EN/ZH
  i18n. Breaking schema change (dev-stage, no data). See FEAT-008 / PLAN-010.
- Document row actions + per-user pin: each tree row now exposes a "⋯"
  menu (new child, rename, pin/unpin, delete) replacing the hover-only "+".
  Pins are per-user (new `document_pins` table, kept out of authz tuples
  and out of the shared `document_details` so a shared doc can be pinned
  independently by each viewer), gated by `document:read`. The documents
  home, previously blank, now lists the caller's pinned documents (sorted
  by last update) and falls back to the create prompt when none are
  pinned. EN/ZH i18n. See FEAT-007 / PLAN-008.
- Engineering project management: a new `project` aggregate module
  (`projects` + a single `project_members` table for internal users and
  external supplier/webhook actors, promotable in place), a `procurement`
  `item` sub-type (5-state lifecycle, comment-based event log, grant-gated
  fail-closed visibility), a project dimension on `issue` (nullable
  `project_id` + `assignee_member_id`; personal issues unchanged), and a
  `project` drive `ownerType` (capabilities resolved against
  `project_members`, addressed by project shortId). Assignment targets are
  `project_members.id` so external members can be assigned without a
  `users` row. Admin-only project creation; project read is member-scoped.
  Portal frontend: project list + detail (Overview / Issues / Procurement /
  Files / Members tabs), member management, reused drive FileBrowser, EN/ZH
  i18n. Inbound/outbound events are designed only (see
  [project module doc](modules/project.md)). See FEAT-004 / PLAN-004.
- Markdown editor source view: a toolbar toggle (`FileCode2`) switches the
  Milkdown surface in place to an editable raw-markdown view backed by a
  CodeMirror 6 instance (markdown highlighting, line wrapping). Edits stream
  back into Milkdown on toggle-back; the CodeMirror chunk is lazy-loaded so
  WYSIWYG-only use never pays for it. Shown in full (non-compact) editors
  only. EN/ZH i18n. See FEAT-003 / PLAN-003.
- Drive web UI: a three-tab page (My files / Team directories / Shared
  with me) assembling the file browser, share dialog + lists, team-directory
  list + member management, and file preview into one route, with full
  EN/ZH i18n.
- Owner-aware folder and text-file creation from the UI — creating inside a
  team directory now produces team-owned entries (editor+ gated), wired
  through `useCreateDriveFolder` / `useCreateTextFile`.
- Live e2e coverage for owner-scoped entry listing and folder/text-file
  create gating by team-directory role.
- Faithful drive file preview: in-app full-bleed viewer rendering images
  (react-zoom-pan-pinch zoom/pan/rotate), PDFs (react-pdf paged render with
  thumbnails), markdown (sanitized preview), and code/text (shiki
  theme-synced highlight), with inline edit + save via version upload. The
  heavy renderers (react-pdf/pdfjs-dist, react-zoom-pan-pinch, shiki) and
  the pdf.js worker are lazy-loaded as on-demand chunks. See
  [decision 001](decisions/001-drive-preview-stack.md).
- `context-menu` UI primitive (`@base-ui/react/context-menu`) for right-click
  per-item and blank-area "create here" menus.
- Document collaborator sharing wired into the documents detail UI (add /
  remove user or group viewer/editor, inherited grants shown and
  non-removable), replacing the previous "coming soon" stub.
- Document public-link sharing: view-only token links with optional password
  (argon2id, write-only) and expiry, owner-only management, and folder/subtree
  recursion so a link on a folder grants view access to its whole subtree.
  Adds the `document_public_links` table + migration, unauthenticated token
  routes (gate metadata / content / attachment streaming), and a ShareDialog
  public-link section (create / revoke / copy URL) with EN/ZH i18n.
- Public documents viewer page (`/documents/shared/:token`): unauthenticated,
  view-only markdown rendering with password and expiry enforcement, subtree
  navigation for folder links, and attachment view/download.

### Changed

- Removed the `portal` concept from the frontend entirely. The dashboard
  moved from `/portal` to `/overview`, and module routes now mount at the
  root (`/drive`, `/documents`, `/issues`, `/projects`); `/admin/*` and the
  root redirect are unchanged. Default post-login landing and the drive share
  URL updated accordingly. The rename also covers the sidebar nav area
  (`NavArea` `portal` → `overview`), nav key/label, the `portal` i18n
  namespace (`portal.json` → `overview.json`, "Portal"/"门户" → "Overview"/"概览"),
  `denied.backToPortal` → `backToOverview`, and the `shared/components/portal/`
  document-tree utils directory → `shared/components/documents/`. React DOM
  portals (`createPortal`, `*.Portal`) are unrelated and untouched.
  See REFACTOR-001 / PLAN-006.
- Unified sharing into one `share` module backed by a single polymorphic
  `shares` table (`resource_type` + `resource_id`, no DB FK). Replaces the
  former per-module `document_public_links` and `drive_file_shares` tables and
  their duplicated services/routes. Resource specifics (validation, public
  content rendering, manage authorization) plug in through a per-resource
  adapter registry; documents and drive register adapters via side-effect
  imports. Management API: `/shares/:type/:id`, `/shares/:shareId`,
  `/shares/{received,sent,links}`, `/shares/capabilities/:type`. Public access:
  `/shared/:token` (+ `/list`, `/download[/:childId]`). Document collaborator
  (viewer/editor) grants stay policy tuples — out of scope. Breaking: drops the
  old tables and routes (no data migration). See FEAT-002 / PLAN-002.

- Documents selection now lives in the URL as a path param
  (`/portal/documents/:docId`) via a master-detail layout that keeps the tree
  sidebar mounted across switches; creating a document (root or child) now
  navigates to the new document instead of bouncing back to the empty state.

- Every drive entry list now renders through one reusable
  `DriveFileListSurface` (search / filter / sort / grid-list / multi-select /
  context menus), with folder vs collection toolbar configs. Consumers: the
  folder file-browser, the recent/favorites/trash entry list, the share
  lists, and the file picker.

### Removed

- `shiki` dependency — drive file preview highlighting now uses the existing
  CodeMirror 6 stack (see Changed).
- Dead `-use-drive-selection.ts` hook (selection state now lives inside the
  shared surface).
- `document_public_links` and `drive_file_shares` tables and their
  `*.share.service.ts` / `*.public.routes.ts` modules, superseded by the
  unified `share` module. The former gap where `document_public_links` was
  never included in backups is closed by the new `share` backup contribution.

### Security

- Documents are now owner-scoped: the admin role no longer bypasses document
  access on list, read, tree, or share-management paths. Admins see only their
  own and explicitly shared documents, matching drive personal-file behavior.
  Breaking change (R&D): admins lose blanket visibility into other users'
  documents.

## 2026-05-21

### Removed

- libsql, the `encryption` module, and the locked/setup/unlock lifecycle.
  API now uses `bun:sqlite` directly via Drizzle's `bun-sqlite` adapter.
- Env vars `DB_ENCRYPTION`, `MASTER_PASSWORD_FILE`,
  `ENABLE_EXPERIMENTAL_DEK_ROTATION`.
- Endpoints under `/api/encryption` and the frontend `/setup` and
  `/unlock` routes.

This is a breaking change with no backward-compatibility path: at-rest
encryption is now the operator's responsibility (full-disk encryption,
volume-level encryption, or column wrapping at the application layer).

## v0.1.0 — 2026-05-14

First tagged template release. Subsequent forks should anchor their
`develop/forking.md` Part 2 (Tracking upstream) workflow against
`v0.1.0` or later.

### Added

- Bun monorepo skeleton (`apps/api`, `apps/web`, `packages/shared`,
  `packages/tsconfig`).
- Hono API with per-request DI (config / db / encryption / logger
  threaded through `c.var`).
- React 19 + TanStack Router web app with EN/ZH i18n and file-based
  routes.
- Shipped modules: `account/auth` (OAuth + TOTP), `account/users`,
  `policy` (Zanzibar tuples), `item` (base) + `file` / `document` /
  `issue` (sub-types), `cron`, `backup`, `audit`, `encryption`,
  `settings`, `system`.
- ECIES at-rest encryption with bootstrap-token, master-password
  derived keypair, and admin DEK challenge-response.
- Live e2e harness (dex + API + every module).
- Single-binary build via `scripts/compile.ts`.
- `scripts/rebrand.ts` rewrites manifests + `.env` defaults for forks.
- Doc-drift safeguards: `check:i18n` / `check:env-docs` /
  `check:api-docs`.
- `.github/workflows/ci.yml` + `release.yml`.

### Security

- Sentinel guards refuse production boot with example
  `OAUTH_CLIENT_SECRET=app-secret`, `OAUTH_CLIENT_ID=app`,
  `DEFAULT_ADMIN=admin@example.com`.
- `SERVICE_TOKEN` split into `SERVICE_TOKEN_METRICS` /
  `SERVICE_TOKEN_BACKUP` (independently rotatable).
- CSRF middleware (XHR header + Origin/Referer match), `__Secure-`-
  prefixed session cookies, PKCE + state binding for OAuth.

### Known issues

Tracked separately (lockout persistence, cookie scope vs `BASE_PATH`,
DNS-rebinding guard on the `http-request` cron action, …).
