import type { FileReferenceRow, FileRow, UploadResult } from "./file.service";
import type { PresignedUpload } from "./storage/types";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { AppError } from "@/shared/lib/errors";
import { assertWithinTotalQuota } from "@/shared/lib/upload-limits";
import {
  assertAttachmentCapacity,
  directUploadAvailable,
  findStoredBlob,
  findStoredBlobByHash,
  presignBlobUpload,
  registerUploadedBlob,
  statStoredBlob,
} from "./file.service";

// Generic presigned direct upload for file_references owners (FEAT-050).
// Mirrors the drive's presign/confirm pair (FEAT-044) but produces a plain
// reference instead of a drive entry, so any attachment surface (item /
// comment / HR-doc attachments) can offer direct-to-S3 uploads. AUTHORIZATION
// IS NOT CHECKED HERE — the route resolves "may this actor attach to this
// owner?" exactly like its multipart twin, then calls these.

type DirectUploadConfig = Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_PRESIGN_TTL_SECONDS">;

export interface ReferenceUploadInput {
  readonly ownerType: string;
  readonly ownerId: string;
  readonly filename: string;
  readonly sha256: string;
  readonly mimetype: string;
  readonly uploadedBy: string;
}

export type PresignReferenceUploadResult
  = | { readonly mode: "done"; readonly file: FileRow; readonly reference: FileReferenceRow }
    | { readonly mode: "upload"; readonly upload: PresignedUpload };

/**
 * Phase 1: advisory-check the declared size and caps, then either finish
 * instantly when the SAME user already stored this content (dedup — register
 * the reference, no upload) or hand back a presigned PUT.
 */
export async function presignReferenceUpload(
  db: AppDatabase,
  config: DirectUploadConfig,
  input: ReferenceUploadInput & { readonly size: number },
): Promise<PresignReferenceUploadResult> {
  if (!directUploadAvailable())
    throw new AppError("Direct upload is not available for the active storage backend", 409, "DIRECT_UPLOAD_UNAVAILABLE");
  if (input.size > config.MAX_UPLOAD_BYTES)
    throw new AppError("Upload too large", 413, "UPLOAD_TOO_LARGE");
  await assertAttachmentCapacity(db, config, input.ownerType, input.ownerId);
  await assertWithinTotalQuota(db, config, input.size);

  // Same-uploader scope only (FEAT-044 security): the client-declared sha256
  // is not server-verified, so cross-user instant-dedup could serve poisoned
  // bytes.
  const existing = await findStoredBlob(db, input.sha256, input.uploadedBy);
  if (existing) {
    const registered = await registerUploadedBlob(db, {
      sha256: input.sha256,
      size: existing.size,
      mimetype: existing.mimetype,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      filename: input.filename,
      uploadedBy: input.uploadedBy,
    });
    return { mode: "done", file: registered.file, reference: registered.reference };
  }

  const upload = await presignBlobUpload(config, input.sha256, input.mimetype);
  if (!upload)
    throw new AppError("Direct upload is not available", 409, "DIRECT_UPLOAD_UNAVAILABLE");
  return { mode: "upload", upload };
}

/**
 * Phase 2: after the browser PUT the bytes, HEAD the object for the
 * authoritative size + proof it landed, enforce caps against that size, and
 * register the blob + reference. Carries the drive confirm's FIX-048
 * uploader-scoping: an existing blob uploaded by a DIFFERENT user rejects
 * with the same error as a missing object.
 */
export async function confirmReferenceUpload(
  db: AppDatabase,
  config: DirectUploadConfig,
  input: ReferenceUploadInput,
): Promise<UploadResult> {
  const stat = await statStoredBlob(input.sha256);
  if (!stat)
    throw new AppError("Uploaded object was not found in storage", 400, "UPLOAD_NOT_FOUND");
  const existing = await findStoredBlobByHash(db, input.sha256);
  if (existing && existing.uploadedBy !== input.uploadedBy)
    throw new AppError("Uploaded object was not found in storage", 400, "UPLOAD_NOT_FOUND");
  if (stat.size > config.MAX_UPLOAD_BYTES)
    throw new AppError("Upload too large", 413, "UPLOAD_TOO_LARGE");
  await assertAttachmentCapacity(db, config, input.ownerType, input.ownerId);
  await assertWithinTotalQuota(db, config, stat.size);

  return registerUploadedBlob(db, {
    sha256: input.sha256,
    size: stat.size,
    mimetype: input.mimetype,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    filename: input.filename,
    uploadedBy: input.uploadedBy,
  });
}
