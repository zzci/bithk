# PLAN-088 Unified upload UX: global queue, folder grouping, attach-from-drive

- status: Completed
- createdAt: 2026-06-19
- approvedAt: 2026-06-19
- relatedTask: UI-027

## Context

Two gaps made file attachment inconsistent across the app:

1. The upload-queue panel lived in the drive feature and was only rendered on
   the drive page. Uploads started from a project or ship attachment area ran
   with no visible progress.
2. There was no way to attach an existing drive file to a resource. Users had to
   download from the drive and re-upload the same bytes, duplicating the blob.

The file module already models attachments as `file_references` rows over shared
`files` blobs with a materialised `ref_count`, and `file.service.addReference`
already registers an extra reference to a stored blob (refcount bump, no
re-upload). The drive permission layer already exposes `assertEntryCapability`
for an authoritative per-entry READ check.

## Goal

Show upload progress on every surface, and let any resource attach an
already-stored drive file by reference (zero re-upload) without weakening
per-entry access control.

## Proposal

- **Promote the queue to shared** (`shared/components/file/upload-queue.ts` +
  `upload-queue-panel.tsx`): move the store (`useFileUploadStore`), the
  `useFileUploader` hook, and the panel out of the drive feature so they are
  reusable.
- **Mount globally** (`app/routes/_app.tsx`): render `UploadQueuePanel` once in
  the app layout. The panel returns `null` when the queue is empty and not
  preparing, so it is invisible until an upload starts.
- **Folder-grouped progress**: `UploadTask` carries an optional `relativePath`.
  The panel groups tasks by their top-level folder, showing a folder header with
  a file count (`common:upload.folderFiles`) and aggregate progress, with loose
  files rendered flat and an overall `done/total` summary. A `preparing` flag
  drives a "creating folders" placeholder while folder paths are materialised.
  Upload copy moved to the `common` i18n namespace.
- **Attach-from-drive endpoint**: `POST /:id/attachments/from-drive` on the
  `document`, `issue`, `procurement`, and `hr` modules. The handler:
  1. asserts the actor's upload/write capability on the target resource;
  2. calls `assertEntryCapability(db, actor, entryId, "read")` — the
     client-supplied entry id is never trusted (404 when no relationship, 403
     when visible but not readable);
  3. resolves the entry's stored `fileId` and calls `addReference` with
     `ownerType: "item_attachment"`, returning an `AttachmentView`.
  No new blob is written; the shared blob's `ref_count` is incremented.
- **Choose-from-Drive UI**: a button in resource attachment areas opens the
  existing `-drive-file-picker` and posts the picked entry id to the new
  endpoint.

## Verification

- `bun run check` exits 0 (lint, typecheck, web + api tests, build, check:i18n,
  check:api-docs, check:api-spec, check:routes).
- `UploadQueuePanel` test: folder grouping with file count, overall summary,
  loose-file rendering, and the preparing placeholder.
- Backend from-drive test: happy path returns 201 with a new `item_attachment`
  reference, bumps the blob refcount to 2, and adds no new blob row; an entry
  the actor cannot read is rejected (404/403) with no reference added.
