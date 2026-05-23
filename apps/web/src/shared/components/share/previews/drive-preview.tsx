// Public drive share preview: a single file (metadata card + download +
// in-app preview) or a read-only folder browser (breadcrumb + entries, each
// file previewable / downloadable). Subtree-scoped server-side.

import type { FormEvent } from "react";
import type { FileType } from "@/app/routes/_app/portal/-file-browser-types";
import type { DriveEntry } from "@/shared/lib/api/drive";
import type { PublicDriveContent, PublicShareEntry, PublicShareListing, PublicShareMeta } from "@/shared/lib/api/share";
import { ArrowDown, ArrowUp, ChevronRight, Download, Eye, FileText, Folder, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { detectFileType, FILE_ICONS } from "@/app/routes/_app/portal/-file-browser-types";
import { FilePreviewDialog, resolvePreviewKind } from "@/app/routes/_app/portal/-file-preview-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  accessPublicShare,
  downloadPublicShareChild,
  downloadPublicShareFile,
  fetchPublicShareChild,
  fetchPublicShareFile,
  listPublicShareEntries,
} from "@/shared/lib/api/share";
import { errorMessage } from "@/shared/lib/errors";
import { HttpError } from "@/shared/lib/http";

import { formatBytes } from "../share-helpers";
import { ShareShell } from "./shell";

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

export function DrivePublicPreview({ meta, token }: { readonly meta: PublicShareMeta; readonly token: string }) {
  if (meta.isFolder)
    return <FolderShare token={token} meta={meta} />;
  return <FileShare token={token} meta={meta} />;
}

function FileShare({ token, meta }: { readonly token: string; readonly meta: PublicShareMeta }) {
  const { t } = useTranslation("share");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!meta.requiresPassword);
  const [content, setContent] = useState<PublicDriveContent | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Resolve filename/mimetype/size via the access endpoint, which verifies
  // the optional password server-side and returns the file descriptor.
  const load = useCallback(async (pwd: string) => {
    setError(null);
    try {
      const data = await accessPublicShare<PublicDriveContent>(token, { password: meta.requiresPassword ? pwd : undefined });
      setContent(data);
      setUnlocked(true);
      setAuthError(null);
    }
    catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        setUnlocked(false);
        setContent(null);
        setAuthError(t("public.wrongPassword"));
      }
      else {
        setError(errorMessage(err, t("public.loadError")));
      }
    }
  }, [token, meta.requiresPassword, t]);

  useEffect(() => {
    if (unlocked && !content)
      void load(password);
    // eslint-disable-next-line react/exhaustive-deps -- password captured intentionally; load runs once unlocked.
  }, [unlocked]);

  const fetchContent = useCallback(async (signal: AbortSignal): Promise<Blob> => {
    const res = await fetchPublicShareFile(token, meta.requiresPassword ? password : undefined, signal);
    return res.blob();
  }, [token, meta.requiresPassword, password]);

  const file = content?.file;
  const previewEntry = useMemo<DriveEntry | null>(
    () => file ? buildPreviewEntry({ id: token, name: file.filename, mimetype: file.mimetype, size: file.size }) : null,
    [token, file],
  );
  const canPreview = file ? resolvePreviewKind(file.mimetype, file.filename) !== "unsupported" : false;

  const handleDownload = async (event?: FormEvent) => {
    event?.preventDefault();
    setDownloading(true);
    setError(null);
    try {
      await downloadPublicShareFile(token, file?.filename ?? meta.name, meta.requiresPassword ? password : undefined);
    }
    catch (err) {
      setError(errorMessage(err, t("public.downloadError")));
    }
    finally {
      setDownloading(false);
    }
  };

  if (!unlocked) {
    return (
      <ShareShell>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void load(password);
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" />
            </div>
            <p className="min-w-0 truncate text-base font-medium">{meta.name}</p>
          </div>
          <PasswordField value={password} onChange={setPassword} />
          {authError && <p className="text-sm text-destructive">{authError}</p>}
          <Button type="submit" disabled={!password}>
            <Lock className="size-4" />
            {t("public.open")}
          </Button>
        </form>
      </ShareShell>
    );
  }

  return (
    <ShareShell>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-medium">{file?.filename ?? meta.name}</p>
            {file && <p className="text-sm text-muted-foreground">{formatBytes(file.size)}</p>}
          </div>
        </div>

        <form className="flex flex-col gap-3" onSubmit={handleDownload}>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {canPreview && (
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="size-4" />
              {t("public.preview")}
            </Button>
          )}
          <Button type="submit" disabled={downloading || !file}>
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("public.download")}
          </Button>
        </form>
      </div>

      {previewOpen && previewEntry && (
        <FilePreviewDialog
          entry={previewEntry}
          open
          readOnly
          fetchContent={fetchContent}
          onDownload={() => void handleDownload()}
          onOpenChange={open => !open && setPreviewOpen(false)}
        />
      )}
    </ShareShell>
  );
}

function FolderShare({ token, meta }: { readonly token: string; readonly meta: PublicShareMeta }) {
  const { t } = useTranslation("share");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!meta.requiresPassword);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<PublicShareListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (parent: string | undefined, pwd: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPublicShareEntries(token, { password: meta.requiresPassword ? pwd : undefined, parentId: parent });
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

  useEffect(() => {
    if (unlocked)
      void load(parentId, password);
    // eslint-disable-next-line react/exhaustive-deps -- password captured intentionally; reloads are driven by parentId/unlock.
  }, [unlocked, parentId]);

  const [previewItem, setPreviewItem] = useState<PublicShareEntry | null>(null);
  const previewFetch = useCallback(async (signal: AbortSignal): Promise<Blob> => {
    const id = previewItem?.id;
    if (!id)
      throw new Error("no file");
    const res = await fetchPublicShareChild(token, id, meta.requiresPassword ? password : undefined, signal);
    return res.blob();
  }, [token, previewItem?.id, meta.requiresPassword, password]);
  const previewEntry = useMemo<DriveEntry | null>(
    () => previewItem ? buildPreviewEntry({ id: previewItem.id, name: previewItem.name, mimetype: previewItem.mimetype ?? "", size: previewItem.size ?? 0 }) : null,
    [previewItem],
  );

  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (!unlocked) {
    return (
      <ShareShell>
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
            <p className="truncate text-base font-medium">{meta.name}</p>
          </div>
          <PasswordField value={password} onChange={setPassword} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading || !password}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {t("public.open")}
          </Button>
        </form>
      </ShareShell>
    );
  }

  const breadcrumb = listing?.breadcrumb ?? [{ id: token, name: meta.name }];
  const entries = sortEntries(listing?.entries ?? [], sortDir);
  const pwd = meta.requiresPassword ? password : undefined;
  const previewable = (entry: PublicShareEntry) => entry.type === "file" && resolvePreviewKind(entry.mimetype ?? "", entry.name) !== "unsupported";

  return (
    <ShareShell wide>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {breadcrumb.map((crumb, i, arr) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/60" />}
              <button
                type="button"
                onClick={() => setParentId(i === 0 ? undefined : crumb.id)}
                className={i === arr.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground"}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          type="button"
          onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
          className="flex w-fit items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("public.columnName")}
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
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t("public.empty")}</div>
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
                            setParentId(entry.id);
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
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("public.download")} onClick={() => void downloadPublicShareChild(token, entry.id, entry.name, pwd)}>
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
          onDownload={() => previewItem && void downloadPublicShareChild(token, previewItem.id, previewItem.name, pwd)}
          onOpenChange={open => !open && setPreviewItem(null)}
        />
      )}
    </ShareShell>
  );
}

function PasswordField({ value, onChange }: { readonly value: string; readonly onChange: (v: string) => void }) {
  const { t } = useTranslation("share");
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
