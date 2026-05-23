/* eslint-disable react-refresh/only-export-components */
// Public, unauthenticated landing page for a drive public-link share
// (`/drive/shared/:token`, the URL `buildPublicShareUrl` produces).
//   - file share   -> metadata card + download (password-gated when protected)
//   - folder share -> read-only folder browser (breadcrumb + entries), each
//                     file downloadable; subtree-scoped server-side.
// Mirrors the unauth backend at `/api/drive/shared/:token(/list|/file/:id)`.

import type { FormEvent } from "react";
import type { FileType } from "./_app/portal/-file-browser-types";
import type { DriveEntry, PublicShareEntry, PublicShareListing, PublicShareMetadata } from "@/shared/lib/api/drive";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronRight, Download, Eye, FileText, Folder, Loader2, Lock, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Logo } from "@/shared/components/logo";
import { ModeToggle } from "@/shared/components/mode-toggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { downloadPublicShareFile, listPublicShareEntries, usePublicShare } from "@/shared/lib/api/drive";
import { errorMessage } from "@/shared/lib/errors";
import { httpRaw } from "@/shared/lib/http";
import { detectFileType, FILE_ICONS } from "./_app/portal/-file-browser-types";
import { FilePreviewDialog, resolvePreviewKind } from "./_app/portal/-file-preview-dialog";

export const Route = createFileRoute("/drive/shared/$token")({
  component: PublicSharePage,
});

function formatBytes(value: number): string {
  if (value < 1024)
    return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/** Minimal `DriveEntry` the in-app viewer needs; bytes come from a fetch override. */
function buildPreviewEntry(parts: { id: string; name: string; mimetype: string; size: number }): DriveEntry {
  return {
    id: parts.id,
    ownerType: "user",
    ownerId: "",
    parentEntryId: null,
    type: "file",
    name: parts.name,
    favorite: false,
    status: "normal",
    createdAt: "",
    updatedAt: "",
    file: { referenceId: "", fileId: "", filename: parts.name, mimetype: parts.mimetype, size: parts.size },
  };
}

/** Display file-type for a public listing entry (drives the row icon). */
function entryFileType(entry: PublicShareEntry): FileType {
  return entry.type === "folder" ? "folder" : detectFileType(entry.mimetype ?? "");
}

/** Folders first, then by name; `dir` flips the name comparison only. */
function sortEntries(entries: readonly PublicShareEntry[], dir: "asc" | "desc"): PublicShareEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.type === "folder") !== (b.type === "folder"))
      return a.type === "folder" ? -1 : 1;
    const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });
}

function Shell({ children, wide }: { readonly children: React.ReactNode; readonly wide?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center p-4">
        <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-xl border bg-background p-6 shadow-sm`}>
          {children}
        </div>
      </main>
    </div>
  );
}

function Status({ icon, title }: { readonly icon: React.ReactNode; readonly title: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {icon}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
    </div>
  );
}

function PublicSharePage() {
  const { token } = Route.useParams();
  const { t } = useTranslation("drive");
  const query = usePublicShare(token);

  if (query.isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {t("common:common.loading")}
        </div>
      </Shell>
    );
  }

  const meta = query.data;
  if (query.error || !meta)
    return <Shell><Status icon={<ShieldAlert className="size-8 text-destructive" />} title={t("public.notFound")} /></Shell>;
  if (meta.expired)
    return <Shell><Status icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.expired")} /></Shell>;
  if (meta.exhausted)
    return <Shell><Status icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.exhausted")} /></Shell>;

  if (meta.isFolder)
    return <FolderShare token={token} meta={meta} />;
  return <FileShare token={token} meta={meta} />;
}

function FileShare({ token, meta }: { readonly token: string; readonly meta: PublicShareMetadata }) {
  const { t } = useTranslation("drive");
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const ready = !meta.requiresPassword || password.length > 0;
  const canPreview = resolvePreviewKind(meta.mimetype, meta.filename) !== "unsupported";

  // Fetch the shared bytes through the public token endpoint (same call the
  // download uses), so the preview reuses the in-app viewer without auth.
  const fetchContent = useCallback(async (signal: AbortSignal): Promise<Blob> => {
    const res = await httpRaw(`/drive/shared/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify(meta.requiresPassword ? { password } : {}),
      signal,
    });
    return res.blob();
  }, [token, meta.requiresPassword, password]);

  // Minimal entry shape the viewer needs; bytes come from `fetchContent`.
  const previewEntry = useMemo<DriveEntry>(
    () => buildPreviewEntry({ id: meta.token, name: meta.filename, mimetype: meta.mimetype, size: meta.size }),
    [meta.token, meta.filename, meta.mimetype, meta.size],
  );

  const handleDownload = async (event?: FormEvent) => {
    event?.preventDefault();
    setDownloading(true);
    setError(null);
    try {
      const res = await httpRaw(`/drive/shared/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify(meta.requiresPassword ? { password } : {}),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = meta.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }
    catch (err) {
      setError(errorMessage(err, t("public.downloadError")));
    }
    finally {
      setDownloading(false);
    }
  };

  return (
    <Shell>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-medium">{meta.filename}</p>
            <p className="text-sm text-muted-foreground">{formatBytes(meta.size)}</p>
          </div>
        </div>

        <form className="flex flex-col gap-3" onSubmit={handleDownload}>
          {meta.requiresPassword && <PasswordField value={password} onChange={setPassword} />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {canPreview && (
            <Button type="button" variant="outline" disabled={!ready} onClick={() => setPreviewOpen(true)}>
              <Eye className="size-4" />
              {t("public.preview")}
            </Button>
          )}
          <Button type="submit" disabled={downloading || !ready}>
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("public.download")}
          </Button>
        </form>
      </div>

      {previewOpen && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          readOnly
          fetchContent={fetchContent}
          onDownload={() => void handleDownload()}
          onOpenChange={open => !open && setPreviewOpen(false)}
        />
      )}
    </Shell>
  );
}

function FolderShare({ token, meta }: { readonly token: string; readonly meta: PublicShareMetadata }) {
  const { t } = useTranslation("drive");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!meta.requiresPassword);
  const [parentEntryId, setParentEntryId] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<PublicShareListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (parent: string | undefined, pwd: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPublicShareEntries(token, { password: meta.requiresPassword ? pwd : undefined, parentEntryId: parent });
      setListing(data);
      setUnlocked(true);
    }
    catch (err) {
      setError(errorMessage(err, t("public.downloadError")));
    }
    finally {
      setLoading(false);
    }
  }, [token, meta.requiresPassword, t]);

  // Auto-load the root listing once unlocked (or immediately when no password).
  useEffect(() => {
    if (unlocked)
      void load(parentEntryId, password);
    // eslint-disable-next-line react/exhaustive-deps -- password is captured intentionally; reloads are driven by parentEntryId/unlock.
  }, [unlocked, parentEntryId]);

  // Inline preview of a file inside the shared folder. Bytes are fetched from
  // the subtree-scoped per-file endpoint; `previewFetch` stays stable per file
  // so the viewer's load effect doesn't loop.
  const [previewItem, setPreviewItem] = useState<PublicShareEntry | null>(null);
  const previewFetch = useCallback(async (signal: AbortSignal): Promise<Blob> => {
    const id = previewItem?.id;
    if (!id)
      throw new Error("no file");
    const res = await httpRaw(`/drive/shared/${encodeURIComponent(token)}/file/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(meta.requiresPassword ? { password } : {}),
      signal,
    });
    return res.blob();
  }, [token, previewItem?.id, meta.requiresPassword, password]);
  const previewEntry = useMemo<DriveEntry | null>(
    () => previewItem ? buildPreviewEntry({ id: previewItem.id, name: previewItem.name, mimetype: previewItem.mimetype ?? "", size: previewItem.size ?? 0 }) : null,
    [previewItem],
  );

  // Client-side name sort (the only sort this minimal list offers).
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (!unlocked) {
    return (
      <Shell>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void load(undefined, password);
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Folder className="size-5" />
            </div>
            <p className="truncate text-base font-medium">{meta.filename}</p>
          </div>
          <PasswordField value={password} onChange={setPassword} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading || !password}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {t("public.open")}
          </Button>
        </form>
      </Shell>
    );
  }

  const breadcrumb = listing?.breadcrumb ?? [{ id: meta.token, name: meta.filename }];
  const entries = sortEntries(listing?.entries ?? [], sortDir);
  const pwd = meta.requiresPassword ? password : undefined;
  const previewable = (entry: PublicShareEntry) => entry.type === "file" && resolvePreviewKind(entry.mimetype ?? "", entry.name) !== "unsupported";

  return (
    <Shell wide>
      <div className="flex flex-col gap-3">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {breadcrumb.map((crumb, i, arr) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/60" />}
              <button
                type="button"
                onClick={() => setParentEntryId(i === 0 ? undefined : crumb.id)}
                className={i === arr.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground"}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Name-sortable header */}
        <button
          type="button"
          onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          className="flex w-fit items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("browser.column.name")}
          {sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
        </button>

        {loading
          ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                {t("common:common.loading")}
              </div>
            )
          : entries.length === 0
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t("picker.empty")}</div>
            : (
                <ul className="flex flex-col gap-0.5">
                  {entries.map(entry => (
                    <li
                      key={entry.id}
                      className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.type === "folder")
                            setParentEntryId(entry.id);
                          else if (previewable(entry))
                            setPreviewItem(entry);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {FILE_ICONS[entryFileType(entry)]("size-5 shrink-0")}
                        <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                        {entry.type === "file" && (
                          <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(entry.size ?? 0)}</span>
                        )}
                      </button>
                      {entry.type === "file" && (
                        <div className="flex shrink-0 items-center gap-1">
                          {previewable(entry) && (
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("public.preview")} onClick={() => setPreviewItem(entry)}>
                              <Eye className="size-4" />
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("public.download")} onClick={() => void downloadPublicShareFile(token, entry.id, entry.name, pwd)}>
                            <Download className="size-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
      </div>

      {previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          readOnly
          fetchContent={previewFetch}
          onDownload={() => previewItem && void downloadPublicShareFile(token, previewItem.id, previewItem.name, pwd)}
          onOpenChange={open => !open && setPreviewItem(null)}
        />
      )}
    </Shell>
  );
}

function PasswordField({ value, onChange }: { readonly value: string; readonly onChange: (v: string) => void }) {
  const { t } = useTranslation("drive");
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      <span className="flex items-center gap-1.5">
        <Lock className="size-3.5" />
        {t("public.password")}
      </span>
      <Input
        type="password"
        value={value}
        onChange={e => onChange(e.currentTarget.value)}
        placeholder={t("public.passwordPlaceholder")}
        autoComplete="off"
      />
    </label>
  );
}
