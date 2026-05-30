/* eslint-disable react-refresh/only-export-components */
// Drive file preview dialog — a full-fidelity in-app viewer rendered as a
// custom modal overlay (there is no separate viewer route). It fetches the
// entry's bytes through the shared `httpRaw` client (inline=true) and renders
// them faithfully per kind:
//   image            -> react-zoom-pan-pinch (zoom / pan / rotate / reset)
//   application/pdf  -> react-pdf paged <Document>/<Page> (zoom, thumbnails,
//                       ctrl/meta-wheel page nav)
//   markdown         -> sanitized MarkdownPreview; editable via a CodeMirror
//                       source editor
//   text/code        -> CodeMirror read-only syntax highlight (plain <pre>
//                       fallback); editable
//   everything else  -> a download fallback card
//
// Heavy renderers (react-pdf, pdfjs, react-zoom-pan-pinch, the CodeMirror
// code highlighter) are loaded only on demand via dynamic import() so they
// never enter the route shell and only their own async chunks are fetched
// when the matching kind is opened.
//
// Security: untrusted file bytes are never injected as raw HTML. Markdown goes
// exclusively through MarkdownPreview (rehype-sanitize); code/text render
// through CodeMirror, which sets the file bytes as the editor document (text,
// never HTML). Plain text is rendered as text nodes.

import type { WheelEvent as ReactWheelEvent } from "react";
import type { PdfModule, ZoomModule, ZoomRef } from "./-file-preview-types";
import type { DriveEntry } from "@/shared/lib/api/drive";

import {
  Download,
  FileText,
  Focus,
  History,
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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownEditor } from "@/shared/components/editor";
import { Button } from "@/shared/components/ui/button";
import { downloadDriveEntry, useUploadVersion } from "@/shared/lib/api/drive";
import { httpRaw } from "@/shared/lib/http";
import { retypeBlobToMime } from "@/shared/lib/preview-blob";
import { cn } from "@/shared/lib/utils";

import { DriveVersionHistoryDialog } from "./-drive-version-history-dialog";
import { useIsDark } from "./-file-preview-hooks";
import { ImagePreview } from "./-file-preview-image";
import { PdfPreview } from "./-file-preview-pdf";
import { ToolButton } from "./-file-preview-toolbar";
import { errorMessage, formatSize, mimeTypeForSave, resolvePreviewKind } from "./-file-preview-types";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export type { PreviewKind } from "./-file-preview-types";
export { resolvePreviewKind } from "./-file-preview-types";

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

// Code/text surfaces (CodeMirror 6) — read-only highlight and editable editor.
// Lazy so their grammars stay out of the route shell — same code-split
// boundary the former shiki renderer had via its dynamic import.
const CodePreview = lazy(() => import("@/shared/components/editor/code-preview"));
const CodeEditor = lazy(() => import("@/shared/components/editor/code-editor"));

// ── dialog ──

export function FilePreviewDialog({ entry, open, onOpenChange, fetchContent, onDownload, readOnly = false, initialEditing = false }: FilePreviewDialogProps) {
  const { t } = useTranslation("drive");
  const isDark = useIsDark();
  const uploadVersion = useUploadVersion();

  const file = entry.file;
  const kind = file ? resolvePreviewKind(file.mimetype, file.filename) : "unsupported";

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfSidebarOpen, setPdfSidebarOpen] = useState(true);
  const [imageRotation, setImageRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
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

  const pdfWidth = useMemo(() => {
    const horizontalPadding = fullscreen ? 64 : 192;
    const maxWidth = fullscreen ? 1120 : 860;
    return Math.min(maxWidth, Math.max(320, windowWidth - horizontalPadding));
  }, [fullscreen, windowWidth]);

  const canEdit = !readOnly && file != null && (kind === "text" || kind === "markdown");
  const editing = (kind === "text" && textEditing) || (kind === "markdown" && markdownEditing);
  // CodeMirror code surfaces and the markdown editor fill edge-to-edge, so the
  // dialog body drops its padding for them (markdown only while editing; its
  // read-only prose preview keeps the comfortable inset).
  const flushBody = kind === "text" || (kind === "markdown" && markdownEditing);
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
  // Enter edit mode once after the first load when asked (e.g. a freshly
  // created blank file). The ref ensures it fires only on the initial open,
  // not after a save-triggered reload.
  const autoEditDoneRef = useRef(false);

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
      if (initialEditing && !readOnly && !autoEditDoneRef.current) {
        if (kind === "markdown")
          setMarkdownEditing(true);
        else
          setTextEditing(true);
        autoEditDoneRef.current = true;
      }
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
  }, [clearObjectUrl, entry.id, file, kind, fetchContent, initialEditing, readOnly]);

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

  // Re-arm the auto-edit guard when the dialog closes. The edit-on-load itself
  // happens inside `loadFile` (after content arrives); this effect only resets
  // a ref, so it triggers no synchronous re-render.
  useEffect(() => {
    if (!open)
      autoEditDoneRef.current = false;
  }, [open]);

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

  // Track the viewport width while open so the PDF page width can derive from
  // it without a synchronous setState-in-effect.
  useEffect(() => {
    if (!open)
      return;
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

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
              <ToolButton label={t("versions.title")} onClick={() => setVersionsOpen(true)}>
                <History className="size-4" />
              </ToolButton>
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

        <div className={cn("relative min-h-0 flex-1 overflow-hidden", flushBody ? "" : "p-4")}>
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
                  <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                    <MarkdownEditor
                      value={content}
                      onChange={setContent}
                      className="mx-auto min-h-0 w-full max-w-[1100px] flex-1 rounded-none border-0"
                    />
                  </div>
                )
              : (
                  <div className="h-full overflow-auto bg-background">
                    <MarkdownEditor readOnly value={content} />
                  </div>
                )
          )}

          {kind === "text" && file && !loading && (
            <Suspense
              fallback={(
                <pre className="h-full overflow-auto bg-background p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
                  {content}
                </pre>
              )}
            >
              {textEditing
                ? <CodeEditor value={content} filename={file.filename} isDark={isDark} onChange={setContent} />
                : <CodePreview code={content} filename={file.filename} isDark={isDark} />}
            </Suspense>
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
      <DriveVersionHistoryDialog
        entry={entry}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        readOnly={readOnly}
        onSwitched={() => setReloadNonce(n => n + 1)}
      />
    </div>
  );
}
