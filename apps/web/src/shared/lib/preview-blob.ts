/**
 * Re-type a downloaded blob to its declared mimetype so the browser renders
 * it correctly from an ephemeral blob: URL.
 *
 * The file / attachment content endpoints serve script-bearing types such as
 * SVG as `application/octet-stream` (a deliberate safety boundary — see the
 * backend `buildDownloadResponse` and the attachment preview `<img>` surface).
 * A blob: URL carries the blob's own MIME type, so an octet-stream SVG blob
 * would never render in an `<img>`. Slicing with an explicit type yields a
 * correctly-typed blob without trusting the server's Content-Type.
 *
 * Safe because the result is only ever rendered via a plain `<img>` (never
 * inline `<svg>` / `<object>` / `<iframe>`), so an SVG's embedded scripts and
 * event handlers never execute. Pass an empty `mime` to leave the blob as-is.
 */
export function retypeBlobToMime(blob: Blob, mime: string): Blob {
  return mime ? blob.slice(0, blob.size, mime) : blob;
}
