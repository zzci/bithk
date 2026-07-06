# FEAT-050 - Unified presigned direct upload for all attachment surfaces

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

All upload surfaces go direct-to-S3 when the S3 driver is active — not just drive.
Multipart routes remain as the fallback (local driver deployments, direct-upload errors).

## Design

Backend (file module):
- `POST /files/presign-upload` / `POST /files/confirm-upload` generic endpoints carrying
  `{ownerType, ownerId, filename, sha256, size, mimetype}`.
- Per-ownerType authorizer registry (`registerDirectUploadOwner`): each module registers
  authorize (same checks as its multipart route), optional accept policy (ACCEPT_IMAGES for
  covers/avatars), and an optional `onConfirmed` side-effect hook (cover/avatar reference
  swap on the entity row).
- Owners: `item_attachment` (issues/procurement/documents), `item_comment_attachment`,
  `colleague_doc` (HR), `contact_avatar`, `ship_cover`, `project_cover`,
  `project_cover_default` (admin), reusing FIX-048 cross-user checks, quota/size/count caps,
  and audit calls from the multipart paths.

Frontend:
- Shared `directUploadFile()` helper (extracted from upload-queue) used by
  attachment-section, comment-section, cover-field/avatar flows, HR docs; falls back to the
  existing multipart mutation when `directUpload=false` or any direct step fails.
