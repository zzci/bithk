# Drive Module

Personal and team file storage: a per-user file tree plus shared **team
directories**, with file **versioning** and two flavours of **sharing**
(user-to-user "direct" shares and tokenised "public links"). Unlike
`issue` / `document`, the drive is **not** a sub-type of `item` — it owns
its own five tables. File bytes live in the `file` module
(`files` / `file_references`); the drive only holds references, so dedupe,
GC and download streaming all flow through the shared file service.

## File layout

```text
apps/api/src/modules/drive/
  schema.ts                        # 5 tables (entries, team dirs + members, versions, shares)
  drive.service.ts                 # entry CRUD, listing views, trash/restore, permanent delete
  drive.share.service.ts           # direct + public-link shares, public access flow
  drive.team-directory.service.ts  # team directory CRUD + membership + role resolution
  drive.version.service.ts         # version list / upload / switch-current
  drive.upload-validation.ts       # empty + size gate (any file type allowed)
  drive.permission.ts              # capability resolution + policy resource (`driveAccess`)
  drive.file-permission.ts         # file-module read/delete hook for `drive_entry` references
  drive.routes.ts                  # /api/drive/... (authenticated)
  drive.public.routes.ts           # /api/drive/shared/:token (no session)
  drive.backup.ts                  # backup contribution (all 5 tables)
  index.ts                         # route exports + backup registration + file-permission import
  *.test.ts                        # co-located unit tests
```

## Lifecycle

No scheduler or middleware initialisation. Two import-time side effects in
`index.ts`:

- `registerBackupContribution(driveBackupContribution)` — registers the
  drive's tables with the backup registry.
- `import "./drive.file-permission"` — registers a `file` permission hook
  for `drive_entry`-owned references so blob reads / deletes honour drive
  ownership.

The policy resource (`driveAccess`, exported from `drive.permission.ts`)
registers its route bindings as a side effect of mounting
`driveRoutes()` in `routes/protected.ts`.

## Database

Five tables, all owned by this module (see
[database.md](../reference/database.md#drive) for full column lists):

| Table                    | Purpose                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `drive_entries`          | Folder / file nodes. `owner_type` ∈ `{user, team_directory, project}`; `file_reference_id` is the current version pointer; soft delete via `status='trash'`. Unique `(owner_type, owner_id, parent_entry_id, name, status)`. For `project` owners `owner_id` is the project ULID (addressed by the project `short_id` at the API boundary); capabilities resolve against `project_members` (`pm` ≈ admin, internal `member` ≈ editor). See [project.md](project.md). |
| `team_directories`       | Shared drive roots. The creator is an implicit admin.                                     |
| `team_directory_members` | Explicit `{admin, editor, viewer}` membership rows (creator has none).                    |
| `drive_file_versions`    | Append-only per-entry version history (`version_no` unique per entry).                    |
| `drive_file_shares`      | Direct + public-link shares: unique `token`, optional `password` hash / `expires_at` / `max_downloads`, `is_active` for revocation. |

## Routes

Mounted under `protectedRoutes` (every route wraps `authRequired`) except
the two public-link routes, which are mounted under `publicRoutes`. Full
table in [api.md](../reference/api.md#drive). Summary:

**Listing / creation (personal):** `GET /drive/entries`,
`GET /drive/entries/recent`, `GET /drive/entries/favorites`,
`DELETE /drive/entries/trash`, `POST /drive/entries/text-file`,
`POST /drive/folders`, `POST /drive/files/upload`.

**Single entry:** `GET /drive/entries/:id`,
`GET /drive/entries/:id/content`, `PATCH /drive/entries/:id`,
`POST /drive/entries/:id/restore`, `DELETE /drive/entries/:id`,
`DELETE /drive/entries/:id/permanent`.

**Versions:** `GET|POST /drive/entries/:id/versions`,
`POST /drive/entries/:id/versions/:versionId/current`.

**Shares:** `GET|POST /drive/entries/:id/shares`,
`GET /drive/shares/{received,sent,links}`,
`PUT|DELETE /drive/shares/:id`.

**Team directories:** `GET|POST /drive/team-directories`,
`GET|PUT|DELETE /drive/team-directories/:id`,
`GET|POST /drive/team-directories/:id/members`,
`PUT|DELETE /drive/team-directories/:id/members/:memberId`.

**Public (no session):** `GET /drive/shared/:token` (metadata only, includes
`isFolder`), `POST /drive/shared/:token` (verify password + quota, then
download or view-only metadata). For **folder** public links:
`POST /drive/shared/:token/list` (browse a subtree-scoped listing with a
breadcrumb) and `POST /drive/shared/:token/file/:entryId` (download one file,
validated as a descendant of the shared folder). Both files and folders can be
shared; a folder link opens a read-only public browser at the `/drive/shared/
:token` page.

## Permissions

Per-entry capabilities (`read`, `download`, `update`, `delete`, `share`)
are resolved by `resolveEntryCapabilities` from three independent sources,
unioned:

1. **Global admin / personal owner** → the full set.
2. **Team-directory role** — `admin` / `editor` get the full set;
   `viewer` gets read + download only.
3. **Direct share (additive)** — `view` → read; `download` →
   read + download; `edit` → read + download + update. Direct shares never
   confer `delete` or `share`.

Routes enforce this two ways: most call `assertEntryCapability(...)`
directly; the entry routes declared in `driveAccess.routes`
(`GET|PATCH|DELETE /drive/entries/:id`, `/content`, `/restore`,
`/permanent`) are also gated by the global `policyMiddleware`, whose
`bypass` hook delegates to the same capability resolver. Because there are
no Zanzibar tuples for drive entries, an entry the actor has no capability
on — **or one that no longer exists** — fails closed with `403` (the
capability assert runs before the existence check, so a missing id never
reveals whether it existed).

Team-directory **management** (create dir, member add/update/remove,
rename, delete) is gated on the directory role (`getDirectoryRole`), not on
the global admin role — even a global admin must be the directory's
creator/admin to manage its membership.

Creating into a `team_directory` owner — file upload (`/files/upload`),
folder create (`/folders`), and server-side text-file create
(`/entries/text-file`) — requires the caller to be an `editor` or `admin`
of that directory; all three default to the caller's personal drive and
reject any attempt to target another user's drive. Listing
(`GET /drive/entries?ownerType=team_directory&ownerId=…`) is scoped to
members (`viewer`+); a non-member fails closed with `403`.

## Upload validation

The drive is a general file manager and accepts **any file type**. The only
upload gates are emptiness and the per-file size ceiling: `validateDriveUpload`
rejects empty files and files over `MAX_UPLOAD_BYTES` before any blob I/O, and
the drive upload paths (`/files/upload`, `/entries/text-file`, version upload)
call the shared `uploadAndReference` with `allowAnyType: true`, which skips the
file module's MIME allow-list and magic-byte sniff (size and per-resource/quota
limits still apply). This is safe because downloads are served as attachments
for everything except a small inline-safe media set (`buildDownloadResponse`),
so an uploaded SVG/HTML/script cannot execute inline.

## Auditing

Write routes call `audit(...)` with `resourceType` `drive_entry`,
`drive_share` or `team_directory`. Action codes:

`drive.folder.created`, `drive.file.created`, `drive.file.uploaded`,
`drive.file.version_uploaded`, `drive.file.version_switched`,
`drive.entry.updated`, `drive.entry.restored`, `drive.entry.trashed`,
`drive.entry.deleted`, `drive.trash.emptied`, `drive.share.created`,
`drive.share.updated`, `drive.share.revoked`, `drive.share.accessed`
(public link; actor `client:public`), `drive.directory.created`,
`drive.directory.updated`, `drive.directory.deleted`,
`drive.directory.member_added`, `drive.directory.member_updated`,
`drive.directory.member_removed`.

## Backup

`driveBackupContribution` (name `drive`) registers all five tables in
FK-safe order — `team_directories` → `team_directory_members` →
`drive_entries` → `drive_file_versions` → `drive_file_shares` — and
declares `deps: ["users", "files"]`. Blob bytes are **not** part of the
drive contribution; they restore via the `files` contribution. Restoring a
drive backup without its `files` rows leaves dangling references.

## End-to-end coverage

Live e2e suites under `tests/e2e/modules/drive/` (wired via `MODULE_DIRS`
in `tests/e2e/run.ts`):

- **`entries.test.ts`** — folder + file create, multipart upload, list,
  read-by-id, content download round-trip, rename / favorite, recent +
  favorites views, trash → restore → permanent delete, server-side
  text-file create, empty-trash, the per-file size-cap rejection, the
  unauthenticated `401`, and cross-user isolation (`403` on another user's
  private entry).
- **`versions.test.ts`** — upload v1, push v2, list (newest-first +
  `isCurrent`), switch the current pointer back to v1, and download the
  current bytes at each step.
- **`shares.test.ts`** — direct share grants a second user read + download
  (denied before, denied after revoke); sent / received / links inboxes;
  public link with password + single-use cap: unauth metadata, wrong /
  missing password `403`, correct password download, exhaustion `410`,
  expired link `410`, revoke `404`; and a share update (permission +
  activation).
- **`team-directories.test.ts`** — directory create / list / get / rename,
  member add → editor uploads, demote to viewer → upload `403` but
  read/download still work, admin-only member management (`403` for a
  non-admin), member removal → non-member `403`, and directory delete. A
  second case covers owner-scoped listing and create gating: an `editor`
  lists the directory's entries and creates a team-owned folder +
  text-file (`201`), a demoted `viewer` still lists (`200`) but is denied
  both creates (`403`), and a removed non-member is denied the listing
  (`403`).
- **`backup.test.ts`** — `/api/backup/modules` lists `drive`; export
  round-trips a `drive_entries` row; and a drive write lands an
  `audit_events` row reachable via `/api/audit`.

Unit tests are co-located under `apps/api/src/modules/drive/*.test.ts`
(services + permission + upload validation, against a temp SQLite DB with
the real file storage driver — no DB or service mocking).

## Frontend integration

The drive web UI is a three-tab page (`apps/web/src/app/routes/_app/portal/
drive.lazy.tsx`): **My files** (`FileBrowser` over the caller's personal
drive), **Team directories** (a directory list that opens each directory's
`FileBrowser`, role-gated, with a member-management panel for admins), and
**Shared with me** (received / sent / public-link share lists). A
page-level `ShareDialog` and `FilePreviewDialog` are driven by the
`onShareEntry` / `onPreviewEntry` callbacks each `FileBrowser` emits.

### Shared file-list surface

Every list of drive entries renders through **one** reusable presentational
component, `DriveFileListSurface` (`-drive-file-list-surface.tsx`). It owns
all the cross-cutting list behaviour — search, type/owner/modified/source
filters, name/modified sorting (folders first), grid|list view persisted to
`localStorage`, multi-select with rubber-band drag, the batch action bar,
per-row "more actions" dropdowns, and right-click context menus (per-item
actions + a blank-area "create here" menu). It never touches the API
client: each consumer feeds it `DisplayItem[]` plus an `actions` bag and a
`ToolbarConfig`.

The `ToolbarConfig` is a discriminated union:

- **`FolderToolbarConfig`** — full folder browsing (breadcrumbs, create /
  upload, navigation). Used by `FileBrowser` (`-file-browser.tsx`,
  folder-mode) for both personal and team-directory roots.
- **`CollectionToolbarConfig`** — a flat, read-mostly collection (no
  breadcrumbs / create). Used by `-drive-entry-list.tsx` (recent /
  favorites / trash), the share lists (`-share-lists.tsx`), and the
  compact `DriveFilePicker`.

The context menus are backed by a new shared UI primitive,
`@/shared/components/ui/context-menu`, wrapping `@base-ui/react/context-menu`
in the same style as the other `ui/*` primitives (shadcn base-nova ships no
context-menu). See [decision 001](../decisions/001-drive-preview-stack.md).

### File preview rendering stack

`FilePreviewDialog` (`-file-preview-dialog.tsx`) is a full-fidelity in-app
viewer. There is no separate viewer route: it renders as a **custom
full-bleed overlay modal** (`fixed inset-0`, `role="dialog"`) rather than
the shadcn `Dialog`, because the original surface is edge-to-edge (see
[decision 001](../decisions/001-drive-preview-stack.md)). It fetches the
entry's bytes through the shared `httpRaw` client (`inline=true`) and
`resolvePreviewKind(mimetype, filename)` (mimetype authoritative, extension
fallback) picks the renderer:

| Kind | Renderer |
| --- | --- |
| image | **react-zoom-pan-pinch** — zoom / pan / rotate / reset |
| `application/pdf` | **react-pdf** paged `<Document>`/`<Page>` — zoom, thumbnail rail, ctrl/meta-wheel page nav |
| markdown | sanitized `MarkdownPreview` (rehype-sanitize); editable via a shiki-backed source editor |
| text / code | **shiki** (`shiki/bundle/web`) syntax highlight, theme-synced to the app theme; plain `<pre>` fallback; editable |
| everything else | a download fallback card |

Markdown and code/text are **editable inline**: the dialog saves edits by
uploading a new version through `useUploadVersion` (the version becomes the
entry's current pointer), so edits flow through the same versioning path as
any other upload.

**Lazy loading.** The heavy renderers (`react-pdf` + `pdfjs-dist`,
`react-zoom-pan-pinch`, `shiki`) are loaded only on demand via dynamic
`import()`, so they stay out of the route shell and the shared vendor
chunks; only the chunk matching the opened file kind is fetched. shiki
further splits per-language grammar and per-theme chunks. The pdf.js worker
is wired as a Vite asset URL import
(`pdfjs-dist/build/pdf.worker.min.mjs?url`) and ships as its own `.mjs`
asset. `pdfjs-dist` is pinned to the exact version `react-pdf` bundles.

**Security.** Untrusted file bytes are never injected as raw HTML: markdown
goes only through `MarkdownPreview` (rehype-sanitize), shiki emits HTML it
generates from escaped text, and plain text renders as text nodes.

A `DriveFilePicker` component lets other modules browse the drive and pick
a file to attach. Import it as:

```ts
import { DriveFilePicker } from "@/app/routes/_app/portal/-drive-file-picker";
```

It accepts `{ open, onOpenChange, onPick, ownerType?, ownerId? }` and
returns the chosen `DriveEntry` via `onPick`. The component exists and is
build-clean, but **no consumer is wired to it yet** (TODO — an
item-attachment proxy is the intended first caller).

## Out of scope

- **Blob-data migration from backup** — the drive backup carries table
  rows only; blob bytes restore via the `files` contribution.
- **S3 / remote storage driver** — drive uses whatever driver the `file`
  module has active; no drive-specific driver.
- **Client-side encryption** of drive files.
- **Rich PDF annotation / preview** beyond raw download + inline render.
- **Granular ACLs beyond the four roles** (owner + team admin / editor /
  viewer + the three direct-share permissions). No per-entry custom ACL
  grammar.
