/**
 * Tiny magic-byte sniffer for the small whitelist of MIME categories we
 * accept on uploads (images, PDF, text, zip, 7z).
 *
 * The client-supplied `file.type` cannot be trusted — a `.svg` (which is XML
 * with possible script payloads) can claim `image/png`. We sniff the first
 * 16 bytes and return the inferred top-level category. Callers compare that
 * to the claimed type and reject mismatches before persisting the file.
 *
 * The sniffer is deliberately conservative: when no signature matches we
 * return `null` so the caller's policy decides (today: also reject).
 */

export type SniffedKind
  = | "jpeg"
    | "png"
    | "gif"
    | "bmp"
    | "webp"
    | "tiff"
    | "pdf"
    | "text"
    | "zip"
    | "7z";

interface Signature {
  readonly kind: SniffedKind;
  readonly bytes: readonly number[];
  readonly offset?: number;
}

const SIGNATURES: readonly Signature[] = [
  // Images — specific subtypes so `mimeMatchesContent` can refuse a
  // mis-declared upload (jpeg bytes claiming image/png, etc.) instead of
  // accepting every image/* claim by category. WebP is handled below as a
  // special case because the RIFF prefix is shared with WAV / AVI.
  { kind: "jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { kind: "png", bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { kind: "gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // gif87a
  { kind: "gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // gif89a
  { kind: "bmp", bytes: [0x42, 0x4D] },
  { kind: "tiff", bytes: [0x49, 0x49, 0x2A, 0x00] }, // little-endian
  { kind: "tiff", bytes: [0x4D, 0x4D, 0x00, 0x2A] }, // big-endian

  // PDF
  { kind: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF

  // Archives
  { kind: "zip", bytes: [0x50, 0x4B, 0x03, 0x04] }, // zip local file header
  { kind: "zip", bytes: [0x50, 0x4B, 0x05, 0x06] }, // empty zip
  { kind: "zip", bytes: [0x50, 0x4B, 0x07, 0x08] }, // spanned zip
  { kind: "7z", bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
];

function matches(buf: Uint8Array, sig: Signature): boolean {
  const offset = sig.offset ?? 0;
  if (buf.length < offset + sig.bytes.length)
    return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buf[offset + i] !== sig.bytes[i])
      return false;
  }
  return true;
}

/**
 * Real WebP files start with `RIFF` (4 bytes) + 4-byte size + `WEBP`.
 * A plain `RIFF` prefix would also match WAV and AVI, so WebP is sniffed
 * via the combined fingerprint rather than via the generic SIGNATURES
 * table.
 */
function isWebp(buf: Uint8Array): boolean {
  if (buf.length < 12)
    return false;
  return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
}

function looksLikeText(buf: Uint8Array): boolean {
  if (buf.length === 0)
    return true;
  // Reject obvious binary: ANY null byte in the first 1KiB collapses the
  // text classification. Then require ≥95% printable ASCII / common UTF-8
  // continuation bytes, which is plenty for plain text, source code, csv.
  let printable = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    if (b === 0)
      return false;
    // tab, lf, cr, printable ascii, or any > 0x7F (utf-8 continuation /
    // multibyte lead). The byte-level test is intentionally lenient.
    if (b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || b > 0x7F)
      printable++;
  }
  return printable / buf.length >= 0.95;
}

/**
 * Sniff the leading bytes of a file and return the inferred kind, or null
 * when no signature matches. Empty buffers count as text (zero-byte text
 * files are legitimate uploads).
 */
export function sniffKind(buf: Uint8Array): SniffedKind | null {
  // WebP must be checked before the generic SIGNATURES table because the
  // shared `RIFF` prefix would otherwise need a dedicated entry; we keep
  // the table prefix-only and let isWebp() apply the offset-8 verification.
  if (isWebp(buf))
    return "webp";
  for (const sig of SIGNATURES) {
    if (matches(buf, sig))
      return sig.kind;
  }
  if (looksLikeText(buf))
    return "text";
  return null;
}

// Canonical MIME per definite magic-byte kind. `text` is deliberately
// absent: the text heuristic is too weak to *claim* a type (JSON snapshots,
// CSVs and source code all sniff as text), so `sniffMime` stays magic-only
// and the extension map decides for text-like content.
const KIND_MIME: Record<Exclude<SniffedKind, "text">, string> = {
  "jpeg": "image/jpeg",
  "png": "image/png",
  "gif": "image/gif",
  "bmp": "image/bmp",
  "webp": "image/webp",
  "tiff": "image/tiff",
  "pdf": "application/pdf",
  "zip": "application/zip",
  "7z": "application/x-7z-compressed",
};

/**
 * Best-effort MIME resolution from magic bytes alone (FIX-063). Returns the
 * canonical MIME for a definite signature match, or `null` when the content
 * carries no known signature (including plain text — see {@link KIND_MIME}).
 * Used to recover the type of multipart uploads whose part `Content-Type`
 * was dropped in transport (Bun's server-side `req.formData()`).
 */
export function sniffMime(buf: Uint8Array): string | null {
  const kind = sniffKind(buf);
  if (kind === null || kind === "text")
    return null;
  return KIND_MIME[kind];
}

// Small shared extension → MIME map (FIX-063), the fallback after magic-byte
// sniffing for empty-mimetype uploads. `.sheet` is the Univer spreadsheet
// snapshot (`UNIVER_SHEET_MIME` in the drive module — duplicated here because
// shared/lib must not import module code).
const EXTENSION_MIME: Record<string, string> = {
  "sheet": "application/x-univer-sheet",
  "pdf": "application/pdf",
  "png": "image/png",
  "jpg": "image/jpeg",
  "jpeg": "image/jpeg",
  "gif": "image/gif",
  "webp": "image/webp",
  "bmp": "image/bmp",
  "tif": "image/tiff",
  "tiff": "image/tiff",
  "svg": "image/svg+xml",
  "txt": "text/plain",
  "log": "text/plain",
  "md": "text/markdown",
  "markdown": "text/markdown",
  "csv": "text/csv",
  "tsv": "text/tab-separated-values",
  "json": "application/json",
  "xml": "application/xml",
  "html": "text/html",
  "htm": "text/html",
  "zip": "application/zip",
  "7z": "application/x-7z-compressed",
  "doc": "application/msword",
  "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xls": "application/vnd.ms-excel",
  "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "ppt": "application/vnd.ms-powerpoint",
  "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "mp3": "audio/mpeg",
  "mp4": "video/mp4",
};

/**
 * Resolve a MIME type from the filename extension, or `null` when the
 * extension is unknown or absent. Case-insensitive; dotfiles (`.env`) and
 * trailing-dot names have no extension.
 */
export function mimeFromFilename(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1)
    return null;
  return EXTENSION_MIME[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Verify the claimed MIME type matches what the magic bytes say.
 *
 * For images, the match is on the exact subtype: jpeg bytes claiming
 * `image/png` is rejected so the audit / quota row carries the right
 * type, and the inline-render whitelist downstream stays honest. The
 * common `image/jpg` alias for `image/jpeg` is accepted.
 *
 * For text, anything that looks like ASCII / UTF-8 may claim any
 * `text/*` subtype (we cannot meaningfully sub-classify csv vs plain).
 * `image/svg+xml` is also accepted here because SVG is XML text; it is safe
 * because SVG is never inline-rendered on download (forced to octet-stream).
 */
export function mimeMatchesContent(claimed: string, buf: Uint8Array): boolean {
  const kind = sniffKind(buf);
  if (kind === null)
    return false;
  const lc = claimed.toLowerCase();
  switch (kind) {
    case "jpeg":
      return lc === "image/jpeg" || lc === "image/jpg";
    case "png":
      return lc === "image/png";
    case "gif":
      return lc === "image/gif";
    case "bmp":
      return lc === "image/bmp" || lc === "image/x-ms-bmp";
    case "webp":
      return lc === "image/webp";
    case "tiff":
      return lc === "image/tiff" || lc === "image/x-tiff";
    case "pdf":
      return lc === "application/pdf";
    case "zip":
      return lc === "application/zip" || lc === "application/x-zip-compressed";
    case "7z":
      return lc === "application/x-7z-compressed";
    case "text":
      // SVG is XML text, so it sniffs as `text`. Accept the image/svg+xml
      // claim. SVG is never inline-rendered: buildDownloadResponse forces
      // application/octet-stream + attachment for it, so allowing the upload
      // cannot cause stored XSS.
      return lc.startsWith("text/") || lc === "image/svg+xml";
  }
}
