import type * as ReactPdf from "react-pdf";
import type * as ReactZoomPanPinch from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { UNIVER_SHEET_MIME } from "@/shared/lib/api/drive";

export type PdfModule = typeof ReactPdf;
export type ZoomModule = typeof ReactZoomPanPinch;
export type ZoomRef = ReactZoomPanPinchRef;

export type PreviewKind = "image" | "pdf" | "markdown" | "text" | "unsupported";

// Extensions routed to the plain-text/code <pre> renderer. Markdown is handled
// separately so it can be rendered (not shown as raw source).
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "csv",
  "tsv",
  "ini",
  "conf",
  "env",
  "json",
  "json5",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "xml",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "svg",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "sql",
  "graphql",
  "gql",
  "dockerfile",
  "makefile",
  "gitignore",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx", "mdown", "mkd"]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1)
    return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Decide how to render a file. Mimetype is authoritative; the extension is a
 * fallback for the many `application/octet-stream` / empty-mimetype uploads.
 */
export function resolvePreviewKind(mimetype: string, filename: string): PreviewKind {
  const mime = mimetype.toLowerCase();
  const ext = extensionOf(filename);

  // Univer spreadsheets render in their dedicated editor route; authenticated
  // opens are redirected before this dialog mounts. Classify as unsupported so
  // any stray open (e.g. a public share) shows the download card, never a
  // broken in-dialog render.
  if (mime === UNIVER_SHEET_MIME)
    return "unsupported";
  if (mime.startsWith("image/"))
    return "image";
  if (mime === "application/pdf" || ext === "pdf")
    return "pdf";
  if (mime === "text/markdown" || mime === "text/x-markdown" || MARKDOWN_EXTENSIONS.has(ext))
    return "markdown";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext))
    return "text";
  // Common structured/text payloads served under application/*.
  if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml"))
    return "text";
  return "unsupported";
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0)
    return "";
  if (bytes < 1024)
    return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || Number.isInteger(value) ? 0 : 1)} ${units[unit]}`;
}

export function mimeTypeForSave(kind: PreviewKind, filename: string, mimetype: string): string {
  if (mimetype)
    return mimetype;
  if (kind === "markdown")
    return "text/markdown";
  if (extensionOf(filename) === "csv")
    return "text/csv";
  return "text/plain";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
