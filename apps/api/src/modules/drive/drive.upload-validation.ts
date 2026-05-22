import type { Config } from "@/config";
import { AppError } from "@/shared/lib/errors";
import { isWithinFileSize } from "@/shared/lib/upload-limits";

/**
 * Drive-level upload guard. The drive is a general file manager, so it accepts
 * any file type — only the empty-file and per-file size limits are enforced
 * here (mirroring what the drive routes pass to `uploadAndReference` with
 * `allowAnyType: true`). Type-based restrictions are intentionally NOT applied:
 * downloads are served as attachments for everything except a small
 * inline-safe media set, so arbitrary uploads cannot execute inline.
 */
export function validateDriveUpload(
  file: File,
  config: Pick<Config, "MAX_UPLOAD_BYTES">,
): void {
  if (file.size <= 0)
    throw new AppError("Empty files are not allowed", 400, "VALIDATION_ERROR");
  if (!isWithinFileSize(file.size, config))
    throw new AppError("File size exceeds per-file limit", 400, "FILE_TOO_LARGE");
}
