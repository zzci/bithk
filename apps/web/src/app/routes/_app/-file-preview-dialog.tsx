/* eslint-disable react-refresh/only-export-components */
// Drive file preview dialog — a full-fidelity in-app viewer rendered as a
// custom modal overlay (there is no separate viewer route). It fetches the
// entry's bytes through the shared `httpRaw` client (inline=true) and renders
// them faithfully per kind:
//   image            -> react-zoom-pan-pinch (zoom / pan / rotate / reset)
//   application/pdf  -> react-pdf paged <Document>/<Page> (zoom, thumbnails,
//                       ctrl/meta-wheel page nav)
//   markdown         -> sanitized MarkdownPreview; editable via a shiki-backed
//                       source editor
//   text/code        -> shiki syntax highlight (plain <pre> fallback); editable
//   everything else  -> a download fallback card
//
// Heavy renderers (react-pdf, pdfjs, react-zoom-pan-pinch, shiki) are loaded
// only on demand via dynamic import() so they never enter the route shell and
// only their own async chunks are fetched when the matching kind is opened.
//
// Security: untrusted file bytes are never injected as raw HTML. Markdown goes
// exclusively through MarkdownPreview (rehype-sanitize); shiki output is HTML
// that shiki itself generates from escaped text — never the raw file. Plain
// text is rendered as text nodes.

import type { WheelEvent as ReactWheelEvent } from "react";
import type * as ReactPdf from "react-pdf";
import type * as ReactZoomPanPinch from "react-zoom-pan-pinch";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { DriveEntry } from "@/shared/lib/api/drive";

import {
  Download,
  FileText,
  Focus,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  RotateCw,
  Save,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownEditor } from "@/shared/components/editor";
import { MarkdownPreview } from "@/shared/components/editor/markdown-preview";
import { useTheme } from "@/shared/components/theme-provider";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { downloadDriveEntry, useUploadVersion } from "@/shared/lib/api/drive";
import { httpRaw } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

type PdfModule = typeof ReactPdf;
type ZoomModule = typeof ReactZoomPanPinch;
type ZoomRef = ReactZoomPanPinchRef;

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

// Extension -> shiki language. Unmapped extensions render as a plain <pre>;
// a mapped language not present in shiki's web bundle falls back the same way
// (codeToHtml throws and the highlighter renders plain text).
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  json5: "json5",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  bat: "bat",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  ini: "ini",
  conf: "ini",
  dockerfile: "docker",
  makefile: "make",
};

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

function formatSize(bytes: number): string {
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

function mimeTypeForSave(kind: PreviewKind, filename: string, mimetype: string): string {
  if (mimetype)
    return mimetype;
  if (kind === "markdown")
    return "text/markdown";
  if (extensionOf(filename) === "csv")
    return "text/csv";
  return "text/plain";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve the effective dark/light mode the way the app applies it. */
function useIsDark(): boolean {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined")
      return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return theme === "dark" || (theme === "system" && systemDark);
}

function shikiTheme(isDark: boolean): string {
  return isDark ? "github-dark-dimmed" : "github-light";
}

interface FilePreviewDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  // Optional unauthenticated byte source. When set (e.g. the public share
  // page), the dialog fetches bytes from here instead of the authenticated
  // content endpoint.
  readonly fetchContent?: (signal: AbortSignal) => Promise<Blob>;
  // Optional download override; falls back to the authenticated download.
  readonly onDownload?: () => void;
  // Read-only mode hides edit/save (public viewers cannot save versions).
  readonly readOnly?: boolean;
  // Open directly in edit mode (used right after creating a blank file).
  readonly initialEditing?: boolean;
}

// ── shiki-backed renderers ──

function CodePreview({ code, language, isDark }: { readonly code: string; readonly language: string; readonly isDark: boolean }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { codeToHtml } = await import("shiki/bundle/web");
        const next = await codeToHtml(code, { lang: language, theme: shikiTheme(isDark) });
        if (!cancelled)
          setHtml(next);
      }
      catch {
        if (!cancelled)
          setHtml("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language, isDark]);

  if (html) {
    // shiki emits HTML it generated from the (escaped) source text — not the
    // raw file bytes — so injecting it does not cross a trust boundary.
    return (
      <div
        className="shiki-preview text-sm leading-relaxed [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:p-4"
        // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
      <code>{code}</code>
    </pre>
  );
}

// ── toolbar helpers ──

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            onClick={onClick}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── kind renderers (mounted only when their bytes are ready) ──

function PdfPreview({
  module: pdf,
  fileUrl,
  width,
  zoom,
  sidebarOpen,
  scrollRef,
  pageRefs,
  onWheel,
  onLoadSuccess,
  errorLabel,
}: {
  readonly module: PdfModule;
  readonly fileUrl: string;
  readonly width: number;
  readonly zoom: number;
  readonly sidebarOpen: boolean;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly pageRefs: React.RefObject<Array<HTMLDivElement | null>>;
  readonly onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  readonly onLoadSuccess: (numPages: number) => void;
  readonly errorLabel: string;
}) {
  const { Document, Page } = pdf;
  const [numPages, setNumPages] = useState<number | null>(null);
  const pageNumbers = useMemo(
    () => Array.from({ length: numPages ?? 0 }, (_, index) => index + 1),
    [numPages],
  );

  const scrollToPage = useCallback((page: number) => {
    pageRefs.current[page - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pageRefs]);

  return (
    <Document
      file={fileUrl}
      loading={null}
      error={<p className="p-4 text-sm text-destructive">{errorLabel}</p>}
      onLoadSuccess={({ numPages: n }) => {
        setNumPages(n);
        onLoadSuccess(n);
      }}
      className="h-full min-h-0"
    >
      <div className="flex h-full min-h-0 overflow-hidden rounded-md bg-muted/30">
        {sidebarOpen && (
          <aside className="w-36 shrink-0 overflow-auto bg-background p-2">
            <div className="space-y-2">
              {pageNumbers.map(page => (
                <button
                  key={page}
                  type="button"
                  className="flex w-full flex-col items-center gap-1 rounded-md bg-muted/30 p-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => scrollToPage(page)}
                >
                  <Page
                    pageNumber={page}
                    width={96}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                  <span>{page}</span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <div ref={scrollRef} className="flex-1 overflow-auto" onWheel={onWheel}>
          <div className="flex min-h-full w-full flex-col items-center gap-4 px-6 py-4 pb-10">
            {pageNumbers.map(page => (
              <div
                key={page}
                ref={(node) => {
                  pageRefs.current[page - 1] = node;
                }}
                className="scroll-mt-4"
              >
                <Page pageNumber={page} width={Math.round(width * zoom)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Document>
  );
}

function ImagePreview({
  module: zoom,
  url,
  alt,
  rotation,
  transformRef,
}: {
  readonly module: ZoomModule;
  readonly url: string;
  readonly alt: string;
  readonly rotation: number;
  readonly transformRef: React.RefObject<ZoomRef | null>;
}) {
  const { TransformWrapper, TransformComponent } = zoom;
  return (
    <TransformWrapper
      ref={transformRef}
      initialScale={1}
      minScale={0.5}
      maxScale={6}
      centerOnInit
      limitToBounds={false}
      wheel={{ disabled: true }}
      pinch={{ disabled: true }}
      panning={{ disabled: false, velocityDisabled: true, excluded: ["button"] }}
    >
      <div className="h-full overflow-hidden rounded-md bg-muted/30">
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: "100%", height: "100%" }}
        >
          <div className="flex h-full w-full touch-none items-center justify-center p-4">
            <img
              src={url}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full cursor-grab object-contain select-none active:cursor-grabbing"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </div>
        </TransformComponent>
      </div>
    </TransformWrapper>
  );
}

// ── dialog ──

export function FilePreviewDialog({ entry, open, onOpenChange, fetchContent, onDownload, readOnly = false, initialEditing = false }: FilePreviewDialogProps) {
  const { t } = useTranslation("drive");
  const isDark = useIsDark();
  const uploadVersion = useUploadVersion();

  const file = entry.file;
  const kind = file ? resolvePreviewKind(file.mimetype, file.filename) : "unsupported";
  const language = file ? (LANGUAGE_BY_EXTENSION[extensionOf(file.filename)] ?? null) : null;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfWidth, setPdfWidth] = useState(900);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfSidebarOpen, setPdfSidebarOpen] = useState(true);
  const [imageRotation, setImageRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [markdownEditing, setMarkdownEditing] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const [pdfModule, setPdfModule] = useState<PdfModule | null>(null);
  const [zoomModule, setZoomModule] = useState<ZoomModule | null>(null);
  // Bumped after a successful save to trigger a guarded re-fetch through the
  // load effect (so the request is cancelled on close / unmount like any other).
  const [reloadNonce, setReloadNonce] = useState(0);

  const pdfPagesRef = useRef<Array<HTMLDivElement | null>>([]);
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const pdfWheelLockRef = useRef(false);
  const imageTransformRef = useRef<ZoomRef | null>(null);

  const canEdit = !readOnly && file != null && (kind === "text" || kind === "markdown");
  const editing = (kind === "text" && textEditing) || (kind === "markdown" && markdownEditing);
  const dirty = editing && content !== initialContent;
  const saving = uploadVersion.isPending;
  const previewToolLabel = (key: string) => t(`preview.tools.${key}`);

  const clearObjectUrl = useCallback(() => {
    setObjectUrl((current) => {
      if (current)
        URL.revokeObjectURL(current);
      return null;
    });
  }, []);

  // Fetch the entry bytes. `token` guards against a stale response from a
  // previous entry resolving after a newer load started, and the abort signal
  // cancels the in-flight request on close / entry change / unmount.
  const loadTokenRef = useRef(0);

  const loadFile = useCallback(async (signal: AbortSignal) => {
    if (!file || kind === "unsupported")
      return;

    const token = ++loadTokenRef.current;
    setLoading(true);
    setError(null);
    setContent("");
    setInitialContent("");
    setMarkdownEditing(false);
    setTextEditing(false);
    setNumPages(null);
    setPdfZoom(1);
    setPdfSidebarOpen(true);
    setImageRotation(0);
    pdfPagesRef.current = [];
    clearObjectUrl();

    try {
      const blob = fetchContent
        ? await fetchContent(signal)
        : await httpRaw(`/drive/entries/${encodeURIComponent(entry.id)}/content?inline=true`, { signal }).then(res => res.blob());
      if (signal.aborted || token !== loadTokenRef.current)
        return;

      if (kind === "image" || kind === "pdf") {
        // The content endpoint serves non-inline-safe types (e.g. SVG) as
        // application/octet-stream, which `<img>` will not render. Re-type the
        // blob to the entry's declared mimetype so the image displays. An
        // `<img>`-loaded SVG does not execute scripts, so this stays XSS-safe.
        const mime = file?.mimetype;
        const typed = kind === "image" && mime ? blob.slice(0, blob.size, mime) : blob;
        setObjectUrl(URL.createObjectURL(typed));
        return;
      }

      const text = await blob.text();
      if (signal.aborted || token !== loadTokenRef.current)
        return;
      setContent(text);
      setInitialContent(text);
    }
    catch (err) {
      if (signal.aborted || token !== loadTokenRef.current)
        return;
      setError(errorMessage(err));
    }
    finally {
      if (!signal.aborted && token === loadTokenRef.current)
        setLoading(false);
    }
  }, [clearObjectUrl, entry.id, file, kind, fetchContent]);

  useEffect(() => {
    if (!open)
      return;
    const controller = new AbortController();
    void loadFile(controller.signal);
    return () => {
      controller.abort();
      clearObjectUrl();
    };
  }, [open, loadFile, clearObjectUrl, reloadNonce]);

  // Enter edit mode once after the first load when asked (e.g. a freshly
  // created blank file). A ref ensures it fires only on the initial open, not
  // after a save-triggered reload.
  const autoEditDoneRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoEditDoneRef.current = false;
      return;
    }
    if (!initialEditing || autoEditDoneRef.current || loading || readOnly)
      return;
    if (kind === "markdown") {
      setMarkdownEditing(true);
      autoEditDoneRef.current = true;
    }
    else if (kind === "text") {
      setTextEditing(true);
      autoEditDoneRef.current = true;
    }
  }, [open, initialEditing, loading, readOnly, kind]);

  // Lazy-load react-pdf (+ worker) and react-zoom-pan-pinch only when the
  // matching kind is being previewed.
  useEffect(() => {
    if (!open || kind !== "pdf" || pdfModule)
      return;
    let active = true;
    void (async () => {
      const mod = await import("react-pdf");
      mod.pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      if (active)
        setPdfModule(mod);
    })();
    return () => {
      active = false;
    };
  }, [open, kind, pdfModule]);

  useEffect(() => {
    if (!open || kind !== "image" || zoomModule)
      return;
    let active = true;
    void (async () => {
      const mod = await import("react-zoom-pan-pinch");
      if (active)
        setZoomModule(mod);
    })();
    return () => {
      active = false;
    };
  }, [open, kind, zoomModule]);

  // Track the available render width for PDF pages.
  useEffect(() => {
    if (!open)
      return;
    const updateWidth = () => {
      const horizontalPadding = fullscreen ? 64 : 192;
      const maxWidth = fullscreen ? 1120 : 860;
      setPdfWidth(Math.min(maxWidth, Math.max(320, window.innerWidth - horizontalPadding)));
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [fullscreen, open]);

  // Esc closes the dialog; lock body scroll while open.
  useEffect(() => {
    if (!open)
      return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        onOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  const getCurrentPdfPage = useCallback(() => {
    const container = pdfScrollRef.current;
    if (!container)
      return 1;
    const containerTop = container.getBoundingClientRect().top;
    let currentPage = 1;
    let closestDistance = Number.POSITIVE_INFINITY;
    pdfPagesRef.current.forEach((node, index) => {
      if (!node)
        return;
      const distance = Math.abs(node.getBoundingClientRect().top - containerTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        currentPage = index + 1;
      }
    });
    return currentPage;
  }, []);

  const handlePdfWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey)
      return;
    event.preventDefault();
    if (pdfWheelLockRef.current || Math.abs(event.deltaY) < 12)
      return;

    const currentPage = getCurrentPdfPage();
    const nextPage = event.deltaY > 0
      ? Math.min(numPages ?? currentPage, currentPage + 1)
      : Math.max(1, currentPage - 1);

    if (nextPage !== currentPage)
      pdfPagesRef.current[nextPage - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });

    pdfWheelLockRef.current = true;
    window.setTimeout(() => {
      pdfWheelLockRef.current = false;
    }, 360);
  }, [getCurrentPdfPage, numPages]);

  const centerImageView = useCallback(() => {
    requestAnimationFrame(() => imageTransformRef.current?.centerView());
  }, []);

  const resetImageView = useCallback(() => {
    setImageRotation(0);
    imageTransformRef.current?.resetTransform();
  }, []);

  const handleSave = useCallback(async () => {
    if (!file || !editing || !dirty || saving)
      return;
    setError(null);
    try {
      const newFile = new File([content], file.filename, {
        type: mimeTypeForSave(kind, file.filename, file.mimetype),
      });
      await uploadVersion.mutateAsync({ entryId: entry.id, file: newFile });
      setInitialContent(content);
      setMarkdownEditing(false);
      setTextEditing(false);
      // Re-fetch through the load effect so the view reflects the persisted
      // version and the request is cancelled if the dialog closes meanwhile.
      setReloadNonce(n => n + 1);
    }
    catch (err) {
      setError(errorMessage(err));
    }
  }, [content, dirty, editing, entry.id, file, kind, saving, uploadVersion]);

  const handleCancelEdit = useCallback(() => {
    setContent(initialContent);
    setMarkdownEditing(false);
    setTextEditing(false);
    setError(null);
  }, [initialContent]);

  if (!open)
    return null;

  const sizeLabel = file ? formatSize(file.size) : "";
  const metaLine = file
    ? `${file.mimetype || "application/octet-stream"}${sizeLabel ? ` · ${sizeLabel}` : ""}`
    : "application/octet-stream";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 supports-backdrop-filter:backdrop-blur-xs",
        fullscreen ? "p-0" : "p-4",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget)
          onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry.name}
        className={fullscreen
          ? "flex h-full w-full flex-col overflow-hidden border bg-background shadow-xl"
          : "flex h-[86vh] max-h-[820px] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border bg-background shadow-xl"}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
          <div className="min-w-0">
            <span className="block max-w-[52vw] truncate text-sm font-medium">{entry.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{metaLine}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && !editing && !loading && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (kind === "markdown" ? setMarkdownEditing(true) : setTextEditing(true))}
              >
                <Pencil className="size-4" />
                {previewToolLabel("edit")}
              </Button>
            )}
            {editing && (
              <>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={!dirty || saving || loading}
                  onClick={() => void handleSave()}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {previewToolLabel("save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || loading}
                  onClick={handleCancelEdit}
                >
                  <X className="size-4" />
                  {previewToolLabel("cancel")}
                </Button>
              </>
            )}

            {kind === "pdf" && objectUrl && !loading && (
              <>
                <ToolButton
                  label={previewToolLabel(pdfSidebarOpen ? "hideThumbnails" : "showThumbnails")}
                  pressed={pdfSidebarOpen}
                  onClick={() => setPdfSidebarOpen(value => !value)}
                >
                  {pdfSidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </ToolButton>
                <ToolButton
                  label={previewToolLabel("zoomOut")}
                  disabled={pdfZoom <= 0.5}
                  onClick={() => setPdfZoom(z => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                >
                  <ZoomOut className="size-4" />
                </ToolButton>
                <span className="w-10 text-center text-xs text-muted-foreground">
                  {Math.round(pdfZoom * 100)}
                  %
                </span>
                <ToolButton
                  label={previewToolLabel("zoomIn")}
                  disabled={pdfZoom >= 3}
                  onClick={() => setPdfZoom(z => Math.min(3, Number((z + 0.25).toFixed(2))))}
                >
                  <ZoomIn className="size-4" />
                </ToolButton>
                <ToolButton label={previewToolLabel("resetView")} onClick={() => setPdfZoom(1)}>
                  <Focus className="size-4" />
                </ToolButton>
              </>
            )}

            {kind === "image" && objectUrl && !loading && (
              <>
                <ToolButton label={previewToolLabel("zoomOut")} onClick={() => imageTransformRef.current?.zoomOut()}>
                  <ZoomOut className="size-4" />
                </ToolButton>
                <ToolButton label={previewToolLabel("zoomIn")} onClick={() => imageTransformRef.current?.zoomIn()}>
                  <ZoomIn className="size-4" />
                </ToolButton>
                <ToolButton
                  label={previewToolLabel("rotateLeft")}
                  onClick={() => {
                    setImageRotation(r => r - 90);
                    centerImageView();
                  }}
                >
                  <RotateCcw className="size-4" />
                </ToolButton>
                <ToolButton
                  label={previewToolLabel("rotateRight")}
                  onClick={() => {
                    setImageRotation(r => r + 90);
                    centerImageView();
                  }}
                >
                  <RotateCw className="size-4" />
                </ToolButton>
                <ToolButton label={previewToolLabel("resetView")} onClick={resetImageView}>
                  <Focus className="size-4" />
                </ToolButton>
              </>
            )}

            {file && (
              <ToolButton label={t("preview.download")} onClick={onDownload ?? (() => void downloadDriveEntry(entry))}>
                <Download className="size-4" />
              </ToolButton>
            )}
            <ToolButton
              label={previewToolLabel(fullscreen ? "exitFullscreen" : "fullscreen")}
              pressed={fullscreen}
              onClick={() => setFullscreen(value => !value)}
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </ToolButton>
            <ToolButton label={previewToolLabel("close")} onClick={() => onOpenChange(false)}>
              <X className="size-4" />
            </ToolButton>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden p-4">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              {t("preview.loading")}
            </div>
          )}

          {error && (
            <div className="absolute inset-x-4 top-4 z-20 rounded-md border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive shadow-sm">
              {error}
            </div>
          )}

          {kind === "pdf" && objectUrl && (
            pdfModule
              ? (
                  <div className="h-full">
                    <PdfPreview
                      module={pdfModule}
                      fileUrl={objectUrl}
                      width={pdfWidth}
                      zoom={pdfZoom}
                      sidebarOpen={pdfSidebarOpen}
                      scrollRef={pdfScrollRef}
                      pageRefs={pdfPagesRef}
                      onWheel={handlePdfWheel}
                      onLoadSuccess={setNumPages}
                      errorLabel={t("preview.error")}
                    />
                  </div>
                )
              : (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )
          )}

          {kind === "image" && objectUrl && (
            zoomModule
              ? (
                  <ImagePreview
                    module={zoomModule}
                    url={objectUrl}
                    alt={entry.name}
                    rotation={imageRotation}
                    transformRef={imageTransformRef}
                  />
                )
              : (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                )
          )}

          {kind === "markdown" && !loading && (
            markdownEditing
              ? (
                  <div className="-mx-2.5 -mt-4 flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                    <MarkdownEditor
                      value={content}
                      onChange={setContent}
                      floatingToolbar
                      className="mx-auto min-h-0 w-full max-w-[1100px] flex-1 rounded-none border-0 px-1"
                    />
                  </div>
                )
              : (
                  <div className="h-full overflow-auto bg-background">
                    <MarkdownPreview value={content} />
                  </div>
                )
          )}

          {kind === "text" && !loading && (
            textEditing
              ? (
                  <textarea
                    className="h-full w-full resize-none bg-background font-mono text-sm leading-relaxed text-foreground outline-none"
                    value={content}
                    onChange={event => setContent(event.target.value)}
                    spellCheck={false}
                  />
                )
              : language
                ? (
                    <div className="h-full overflow-auto">
                      <CodePreview code={content} language={language} isDark={isDark} />
                    </div>
                  )
                : (
                    <pre className="h-full overflow-auto rounded-md bg-background font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
                      {content}
                    </pre>
                  )
          )}

          {kind === "unsupported" && !loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <FileText className="size-10 text-muted-foreground/50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("preview.unsupportedTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("preview.unsupportedDescription")}</p>
              </div>
              {file && (
                <Button type="button" variant="outline" size="sm" onClick={onDownload ?? (() => void downloadDriveEntry(entry))}>
                  <Download className="size-4" />
                  {t("preview.download")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
