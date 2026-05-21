/* eslint-disable react-refresh/only-export-components */
// Drive file preview dialog. Fetches the entry's bytes through the shared
// `httpRaw` client (inline=true) and renders them by mimetype/extension:
//   image/*          -> <img> (object-contain, viewport-capped)
//   application/pdf  -> <iframe> of an object URL
//   markdown         -> sanitized MarkdownPreview (react-markdown + rehype-sanitize)
//   text/code        -> plain <pre> (mono); no syntax-highlight dependency added
//   everything else  -> a download fallback card
//
// Security: markdown is rendered exclusively through MarkdownPreview, which
// runs rehype-sanitize over untrusted file content (no raw dangerouslySetInnerHTML).
// Plain text / code is rendered as text nodes, never as HTML.

import type { DriveEntry } from "@/shared/lib/api/drive";

import { Download, FileQuestion, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownPreview } from "@/shared/components/editor/markdown-preview";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { downloadDriveEntry } from "@/shared/lib/api/drive";
import { httpRaw } from "@/shared/lib/http";

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

interface FilePreviewDialogProps {
  readonly entry: DriveEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

type ContentState
  = | { readonly status: "idle" }
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string }
    | { readonly status: "ready"; readonly url: string }
    | { readonly status: "ready-text"; readonly text: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FilePreviewDialog({ entry, open, onOpenChange }: FilePreviewDialogProps) {
  const { t } = useTranslation("drive");
  const kind = entry.file ? resolvePreviewKind(entry.file.mimetype, entry.file.filename) : "unsupported";
  const [content, setContent] = useState<ContentState>({ status: "idle" });

  useEffect(() => {
    if (!open || !entry.file || kind === "unsupported") {
      setContent({ status: "idle" });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setContent({ status: "loading" });

    void (async () => {
      try {
        const res = await httpRaw(`/drive/entries/${encodeURIComponent(entry.id)}/content?inline=true`);
        const blob = await res.blob();
        if (cancelled)
          return;
        if (kind === "image" || kind === "pdf") {
          objectUrl = URL.createObjectURL(blob);
          setContent({ status: "ready", url: objectUrl });
        }
        else {
          const text = await blob.text();
          if (!cancelled)
            setContent({ status: "ready-text", text });
        }
      }
      catch (error) {
        if (!cancelled)
          setContent({ status: "error", message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl)
        URL.revokeObjectURL(objectUrl);
    };
  }, [open, entry.id, entry.file, kind]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{entry.name}</DialogTitle>
          <DialogDescription>{t("preview.description")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <PreviewBody entry={entry} kind={kind} content={content} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  entry,
  kind,
  content,
}: {
  readonly entry: DriveEntry;
  readonly kind: PreviewKind;
  readonly content: ContentState;
}) {
  const { t } = useTranslation("drive");

  if (kind === "unsupported")
    return <DownloadFallback entry={entry} />;

  if (content.status === "loading" || content.status === "idle") {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("preview.loading")}
      </div>
    );
  }

  if (content.status === "error") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-destructive">{t("preview.error")}</p>
        <p className="text-xs text-muted-foreground">{content.message}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void downloadDriveEntry(entry)}>
          <Download className="size-4" />
          {t("preview.download")}
        </Button>
      </div>
    );
  }

  if (kind === "image" && content.status === "ready") {
    return (
      <img
        src={content.url}
        alt={entry.name}
        className="mx-auto max-h-[70vh] w-auto object-contain"
      />
    );
  }

  if (kind === "pdf" && content.status === "ready") {
    return (
      <iframe
        src={content.url}
        title={t("preview.pdfTitle")}
        className="h-[70vh] w-full rounded-md border border-border"
      />
    );
  }

  if (kind === "markdown" && content.status === "ready-text")
    return <MarkdownPreview value={content.text} />;

  if (kind === "text" && content.status === "ready-text") {
    return (
      <pre className="overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {content.text}
      </pre>
    );
  }

  return <DownloadFallback entry={entry} />;
}

function DownloadFallback({ entry }: { readonly entry: DriveEntry }) {
  const { t } = useTranslation("drive");
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
      <FileQuestion className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("preview.unsupportedTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("preview.unsupportedDescription")}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void downloadDriveEntry(entry)}>
        <Download className="size-4" />
        {t("preview.download")}
      </Button>
    </div>
  );
}
