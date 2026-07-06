// Presigned direct upload for attachment surfaces (FEAT-050). Mirrors the
// drive uploader's presign → PUT-to-S3 → confirm flow against the generic
// `.../attachments/presign-upload` + `.../confirm-upload` route pair every
// attachment host mounts. Any failure on the direct path falls back to the
// classic multipart POST so an upload is never lost to S3/CORS trouble —
// and deployments on the local driver (directUpload=false) skip straight
// to multipart.

import { http } from "@/shared/lib/http";

/** SHA-256 of the file's bytes as lowercase hex (the dedup key). */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Record<string, string>;
}

type PresignData
  = | { readonly mode: "done" }
    | { readonly mode: "upload"; readonly upload: PresignedUpload };

async function directUpload(attachmentsPath: string, file: File): Promise<void> {
  const mimetype = file.type || "application/octet-stream";
  const sha256 = await sha256Hex(file);
  const presign = await http<{ data: PresignData }>(`${attachmentsPath}/presign-upload`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, sha256, size: file.size, mimetype }),
  });
  if (presign.data.mode === "done")
    return;

  const { upload } = presign.data;
  // Cross-origin presigned URL carries its own auth — no cookies, only the
  // signed headers (Content-Type).
  const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!put.ok)
    throw new Error(`storage PUT failed: HTTP ${put.status}`);

  await http(`${attachmentsPath}/confirm-upload`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, sha256, mimetype }),
  });
}

/**
 * Upload one attachment to `attachmentsPath` (e.g.
 * `/issues/:id/attachments`): direct-to-S3 when the backend supports it,
 * multipart otherwise — including as the fallback when any direct step
 * fails.
 */
export async function uploadAttachmentFile(attachmentsPath: string, file: File, useDirectUpload: boolean): Promise<void> {
  if (useDirectUpload) {
    try {
      await directUpload(attachmentsPath, file);
      return;
    }
    catch {
      // Fall through to multipart — the server re-checks everything, so a
      // permission/validation failure surfaces from the multipart attempt.
    }
  }
  const fd = new FormData();
  fd.append("file", file);
  await http(attachmentsPath, { method: "POST", body: fd });
}
