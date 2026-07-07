# FEAT-052 - Presign attachment downloads direct to S3 (drop the proxy)

- Status: Completed
- Plan: [PLAN-106](../plan/PLAN-106.md)
- Created: 2026-07-06

## Decision (owner, 2026-07-06)

Attachment (non-inline) downloads should stream straight from S3 via a
presigned GET instead of being proxied through the API. The historical reason
for proxying — "Bun's presign can't sign Content-Disposition" — is obsolete:
Bun 1.3.14's `S3Client.presign` signs both `response-content-disposition` and
`response-content-type` into the URL (verified).

## Design

- `storage/s3.ts` `presignDownload`: actually honour `opts` — sign
  `contentDisposition` (built via `buildContentDisposition(inline?, filename)`,
  so non-ASCII filenames survive) and `type` (the effective content-type).
  Previously it ignored filename/inline/contentType and signed a bare GET.
- `file.service.ts` `buildDownloadResponse`: presign 302 for ALL downloads on
  a presign-capable driver, not only inline-safe ones. Attachment downloads
  sign `attachment; filename="…"` + `application/octet-stream`; inline-safe
  previews sign `inline` + the real content-type. The thumbnail-cache branch
  and the `db`-driver / quarantine branches are unchanged.

## Security

`Content-Disposition: attachment` + `Content-Type: application/octet-stream`
are signed into the URL, so the browser downloads (never renders/executes)
exactly as the old proxy headers did — and the bytes come from the S3 origin,
not the app origin, so no app-cookie/session exposure even in theory. SVG /
HTML / text stay download-only.

## Out of scope

- `db`-driver blobs (spreadsheets, in-app text) keep streaming — no presign.
- Per-download audit of the actual byte transfer (API now only sees the 302,
  as it already did for inline previews).

## Verification

- `s3.test.ts`: presignDownload URL carries `response-content-disposition`
  (attachment + filename, inline) and `response-content-type`.
- `file.test.ts` / download tests: a non-inline download on the s3 driver is a
  302 to the signed URL; db-driver and quarantine paths still stream / 404.
- `bun run check` green.
