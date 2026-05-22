/* eslint-disable react-refresh/only-export-components */
// Public, unauthenticated landing page for a drive public-link share
// (`/drive/shared/:token`, the URL `buildPublicShareUrl` produces). Shows the
// file's metadata and — for download/edit links — a download button, prompting
// for a password when the link is protected. Mirrors the unauth backend at
// `GET/POST /api/drive/shared/:token`.

import type { FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileText, Loader2, Lock, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Logo } from "@/shared/components/logo";
import { ModeToggle } from "@/shared/components/mode-toggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { usePublicShare } from "@/shared/lib/api/drive";
import { errorMessage } from "@/shared/lib/errors";
import { httpRaw } from "@/shared/lib/http";

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

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-sm">
          {children}
        </div>
      </main>
    </div>
  );
}

function PublicSharePage() {
  const { token } = Route.useParams();
  const { t } = useTranslation("drive");
  const query = usePublicShare(token);

  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [viewOnlyNotice, setViewOnlyNotice] = useState(false);

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
  if (query.error || !meta) {
    return (
      <Shell>
        <Status icon={<ShieldAlert className="size-8 text-destructive" />} title={t("public.notFound")} />
      </Shell>
    );
  }
  if (meta.expired) {
    return <Shell><Status icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.expired")} /></Shell>;
  }
  if (meta.exhausted) {
    return <Shell><Status icon={<ShieldAlert className="size-8 text-amber-500" />} title={t("public.exhausted")} /></Shell>;
  }

  const handleDownload = async (event?: FormEvent) => {
    event?.preventDefault();
    setDownloading(true);
    setDownloadError(null);
    setViewOnlyNotice(false);
    try {
      const res = await httpRaw(`/drive/shared/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify(meta.requiresPassword ? { password } : {}),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        // View-only link: the server returns metadata, not bytes.
        setViewOnlyNotice(true);
        return;
      }
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
      setDownloadError(errorMessage(err, t("public.downloadError")));
    }
    finally {
      setDownloading(false);
    }
  };

  const canDownload = meta.permission !== "view";

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
          {meta.requiresPassword && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3.5" />
                {t("public.password")}
              </span>
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
                placeholder={t("public.passwordPlaceholder")}
                autoComplete="off"
              />
            </label>
          )}

          {downloadError && <p className="text-sm text-destructive">{downloadError}</p>}
          {viewOnlyNotice && <p className="text-sm text-muted-foreground">{t("public.viewOnly")}</p>}

          {canDownload
            ? (
                <Button type="submit" disabled={downloading || (meta.requiresPassword && !password)}>
                  {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {t("public.download")}
                </Button>
              )
            : (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {t("public.viewOnly")}
                </p>
              )}
        </form>
      </div>
    </Shell>
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
