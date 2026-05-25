# PLAN-014 Complete missing drive file manager features

- **status**: done
- **createdAt**: 2026-05-25 00:38
- **approvedAt**: 2026-05-25 00:40
- **relatedTask**: FEAT-010

## Context

The current drive implementation already provides personal/team/project owners, folder browsing, upload, file creation, rename, move by dialog, soft delete, restore, permanent delete, recent/favorites/trash collections, shared lists, file picking, upload progress, preview, inline text/markdown editing, and backend version APIs.

Relevant frontend files:

- `apps/web/src/app/routes/_app/-file-browser.tsx`: folder-mode wrapper, upload input, drag-to-upload, create/rename/move/trash dialogs.
- `apps/web/src/app/routes/_app/-drive-file-list-surface.tsx`: shared surface for search, filters, sorting, selection, batch actions, list/grid modes.
- `apps/web/src/app/routes/_app/-drive-file-list-inner.tsx`: row/grid rendering, right-click menus, rubber-band selection, double-click open.
- `apps/web/src/app/routes/_app/-file-preview-dialog.tsx`: preview dialog and inline text/markdown save via version upload.
- `apps/web/src/app/routes/_app/-drive-entry-list.tsx`: recent/favorites/trash collection behavior.
- `apps/web/src/app/routes/_app/-drive-file-picker.tsx`: compact picker behavior.

Relevant API/client files:

- `apps/web/src/shared/lib/api/drive.ts`: drive query/mutation hooks, version hooks, download helper.
- `apps/api/src/modules/drive/drive.routes.ts`: entries, upload, text-file creation, content, versions, update, trash/restore/delete, team directory routes.
- `apps/api/src/modules/drive/drive.service.ts`: listing, creation, update/move/favorite, trash/restore/delete.
- `apps/api/src/modules/drive/drive.version.service.ts`: list/upload/switch versions.
- `apps/api/src/modules/file/file.service.ts`: safe content streaming and inline MIME handling.

Missing or incomplete features from the review:

- Folder upload.
- Direct drag-and-drop move.
- Search beyond the currently loaded folder / full-text search.
- Real thumbnails in grid mode.
- Version history UI and switch-current action.

## Proposal

Implement this in small slices, keeping existing drive APIs and UI patterns where possible.

1. Folder upload
   - Add a directory-capable hidden input in `FileBrowser`.
   - Preserve relative paths from `File.webkitRelativePath`.
   - Add a client helper that creates missing folders before uploading each file.
   - Reuse existing `POST /drive/folders` and `POST /drive/files/upload`; avoid backend bulk-upload unless the client approach proves too fragile.
   - Verify with a focused frontend test for nested folder creation and upload enqueue order.

2. Drag-and-drop move
   - Add internal entry drag metadata to `FileList`.
   - Allow dropping selected entries onto folders and onto the blank/root area.
   - Reuse `PATCH /drive/entries/:id` with `parentEntryId`.
   - Prevent no-op self moves in the UI and rely on backend validation for final safety.
   - Verify with frontend tests for single move and multi-selected move.

3. Drive search
   - Add an API route for drive entry search scoped to owner and optional folder subtree.
   - Start with metadata search by name; do not add content indexing in this slice.
   - Change the search UI to make local vs drive-wide scope explicit.
   - Verify with API tests for owner isolation and frontend tests for search mode.

4. Thumbnails
   - Add a safe thumbnail URL for image entries using the existing content endpoint in inline mode.
   - Render actual image thumbnails in grid mode with icon fallback on load error.
   - Avoid generating thumbnail derivative files in this slice.
   - Verify with frontend rendering tests and existing MIME safety rules.

5. Version history UI
   - Add a version history panel/dialog reachable from file item actions and preview.
   - Use existing `useEntryVersions` and `useSwitchVersion`.
   - Show version number, filename, size, uploader id, created date, and current marker.
   - Allow switching current version for editable users.
   - Verify with focused frontend tests and existing API version tests.

Recommended first implementation batch: folder upload + version history UI. These have the best value-to-risk ratio and can reuse existing backend endpoints. Drag-and-drop move is next. Drive-wide search and thumbnails are more likely to affect API/UI semantics and should follow after the first batch lands.

## Risks

- Folder upload can create partial trees if one nested upload fails. The initial UI should surface per-file failures through the upload queue; stronger transactionality would require backend bulk semantics.
- Drag-and-drop move can conflict with rubber-band selection and external file drop upload. The implementation must separate external `DataTransfer.files` from internal entry drags.
- Drive-wide search must not leak entries across personal/team/project owners or direct shares.
- Thumbnails must preserve the file module's inline-safety guarantees; unsafe image-like content should fall back to icons.
- Version switching must invalidate entry content and version queries so preview reflects the selected current version.

## Scope

Frontend:

- Drive browser controls and context menus.
- Shared file list drag behavior and thumbnail rendering.
- Preview dialog / item action integration for version history.
- Focused Vitest coverage.

Backend:

- Only needed for drive search if that slice is approved.
- Existing folder, upload, content, update, and version endpoints should cover the first implementation batch.

Out of scope unless separately approved:

- Full-text indexing of file contents.
- Server-side zip or recursive folder download.
- Generated thumbnail derivative storage.
- Collaborative locking or conflict resolution.

## Alternatives

- Implement every missing feature in one pass. This is possible but high-risk because it crosses upload semantics, list interactions, API search, preview, and file serving.
- Start with backend bulk folder upload. This gives better atomicity but adds a new route and service path before proving the current endpoints are insufficient.
- Skip drive-wide search and keep current-folder search only. This preserves simple behavior but leaves the largest product-level discoverability gap.

## Annotations

2026-05-25 00:40 — User approved implementing the full scope.

2026-05-25 01:10 — Implementation completed and verified. The final scope
includes recursive folder upload, direct drag-and-drop move, owner-scoped
drive-wide metadata search, grid image thumbnails, version history UI, API
route documentation updates, focused backend coverage, and the existing
frontend regression suite.
