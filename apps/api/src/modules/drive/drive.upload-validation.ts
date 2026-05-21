import type { Config } from "@/config";
import { AppError } from "@/shared/lib/errors";
import { mimeMatchesContent } from "@/shared/lib/mime-sniff";
import { isWithinFileSize } from "@/shared/lib/upload-limits";

/**
 * Drive-level upload validation. The shared `uploadAndReference` already
 * enforces the per-file size ceiling, the MIME allow-list and a magic-byte
 * sniff; this helper runs the same checks *before* any blob I/O **plus** an
 * extension allow-list (which the file service does not model). Keeping the
 * gate here means `/drive/files/upload`, `/drive/entries/text-file` and the
 * version-upload route all reject spoofed / oversized / disallowed uploads
 * with a uniform `400 VALIDATION_ERROR` before bytes are consumed.
 *
 * The accepted MIME categories mirror the file module's allow-list
 * (`image/*`, `application/pdf`, `text/*`, `application/zip`,
 * `application/x-7z-compressed`) so this never accepts something
 * `uploadAndReference` would later refuse.
 */
const ALLOWED_MIMETYPES = /^(?:image\/.*|application\/pdf|text\/.*|application\/zip|application\/x-7z-compressed)$/;

const ALLOWED_EXTENSIONS = new Set([
  // Images (svg is intentionally excluded — it is XML and fails the
  // image magic-byte check anyway).
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
  // PDF
  ".pdf",
  // Text / source
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".log",
  ".yml",
  ".yaml",
  // Archives
  ".zip",
  ".7z",
]);

function fileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0)
    return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Validate an uploaded `File` before it is handed to `uploadAndReference`.
 * Throws `AppError(400, "VALIDATION_ERROR")` (or `FILE_TOO_LARGE`) on any
 * failure. Reads the first 1 KiB of the buffer for the magic-byte check; the
 * file service re-reads the full buffer when it persists the blob.
 */
export async function validateDriveUpload(
  file: File,
  config: Pick<Config, "MAX_UPLOAD_BYTES">,
): Promise<void> {
  if (file.size <= 0)
    throw new AppError("Empty files are not allowed", 400, "VALIDATION_ERROR");
  if (!isWithinFileSize(file.size, config))
    throw new AppError("File size exceeds per-file limit", 400, "FILE_TOO_LARGE");

  const ext = fileExtension(file.name);
  if (ext && !ALLOWED_EXTENSIONS.has(ext))
    throw new AppError(`File extension "${ext}" is not allowed`, 400, "VALIDATION_ERROR");

  const mimetype = (file.type || "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_MIMETYPES.test(mimetype))
    throw new AppError(`File type "${mimetype || "unknown"}" is not allowed`, 400, "VALIDATION_ERROR");

  const buffer = await file.arrayBuffer();
  const sniffWindow = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  if (!mimeMatchesContent(mimetype, sniffWindow))
    throw new AppError("File contents do not match declared type", 400, "VALIDATION_ERROR");
}
