/* eslint-disable react-refresh/only-export-components */
// Public, unauthenticated, view-only landing page for a document
// public-link share (`/documents/shared/:token`, the URL the document
// ShareDialog copies). Mirrors the unauth backend at
// `/api/documents/shared/:token(/attachments/:aid)`:
//   - GET  metadata (title + whether a password is required)
//   - POST content (root or a subtree descendant) once the password verifies
// A link on a folder document grants the same view-only access to every
// descendant; the returned subtree is navigable on the same token. No
// edit, no comments — content is rendered with the same Markdown
// renderer the in-app document detail view uses.

import type { FormEvent } from "react";
import type {
  PublicDocumentAttachment,
  PublicDocumentContent,
  PublicDocumentMeta,
  PublicSubtreeNode,
} from "@/shared/lib/api/documents";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Eye, FileText, Loader2, Lock, Paperclip, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownEditor } from "@/shared/components/editor";
import { Logo } from "@/shared/components/logo";
import { ModeToggle } from "@/shared/components/mode-toggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  accessPublicDocument,
  openPublicDocumentAttachment,
  usePublicDocument,
} from "@/shared/lib/api/documents";
import { errorMessage } from "@/shared/lib/errors";
import { HttpError } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/documents/shared/$token")({
  component: PublicDocumentPage,
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

function Shell({ children, wide }: { readonly children: React.ReactNode; readonly wide?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center p-4">
        <div className={`w-full ${wide ? "max-w-5xl" : "max-w-md"} rounded-xl border bg-background p-6 shadow-sm`}>
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

function PublicDocumentPage() {
  const { token } = Route.useParams();
  const { t } = useTranslation("documents");
  const query = usePublicDocument(token);

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

  return <DocumentViewer token={token} meta={meta} />;
}

function DocumentViewer({ token, meta }: { readonly token: string; readonly meta: PublicDocumentMeta }) {
  const { t } = useTranslation("documents");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!meta.hasPassword);
  const [content, setContent] = useState<PublicDocumentContent | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // Auth errors keep the user on the password prompt; content errors
  // surface inside the loaded view.
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (docId: string | undefined, pwd: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await accessPublicDocument(token, {
        password: meta.hasPassword ? pwd : undefined,
        docId,
      });
      setContent(data);
      setActiveDocId(docId);
      setUnlocked(true);
      setAuthError(null);
    }
    catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        // Wrong / missing password — drop back to the prompt without
        // ever rendering content.
        setUnlocked(false);
        setContent(null);
        setAuthError(t("public.wrongPassword"));
      }
      else if (err instanceof HttpError && err.status === 404) {
        setError(t("public.notFound"));
      }
      else {
        setError(errorMessage(err, t("public.loadError")));
      }
    }
    finally {
      setLoading(false);
    }
  }, [token, meta.hasPassword, t]);

  // Auto-load the root document once unlocked (immediately when there is
  // no password). Re-fetches are otherwise driven by subtree navigation.
  useEffect(() => {
    if (unlocked && !content)
      void load(undefined, password);
    // eslint-disable-next-line react/exhaustive-deps -- password captured intentionally; loads are driven by unlock + explicit navigation.
  }, [unlocked]);

  if (!unlocked) {
    return (
      <Shell>
        <PasswordPrompt
          title={meta.title}
          value={password}
          onChange={setPassword}
          error={authError}
          loading={loading}
          onSubmit={() => void load(undefined, password)}
        />
      </Shell>
    );
  }

  if (loading && !content) {
    return (
      <Shell wide>
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {t("common:common.loading")}
        </div>
      </Shell>
    );
  }

  if (error && !content)
    return <Shell><Status icon={<ShieldAlert className="size-8 text-destructive" />} title={error} /></Shell>;

  if (!content)
    return <Shell><Status icon={<ShieldAlert className="size-8 text-destructive" />} title={t("public.notFound")} /></Shell>;

  const hasSubtree = content.subtree.length > 1;

  return (
    <Shell wide>
      <div className={cn("flex flex-col gap-6", hasSubtree && "md:flex-row md:gap-8")}>
        {hasSubtree && (
          <nav className="shrink-0 md:w-56 md:border-r md:pr-4">
            <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("public.contents")}
            </p>
            <SubtreeNav
              nodes={content.subtree}
              activeId={activeDocId ?? rootId(content.subtree)}
              disabled={loading}
              onSelect={(node) => {
                if (node.id !== (activeDocId ?? rootId(content.subtree)))
                  void load(node.parentId === null ? undefined : node.id, password);
              }}
            />
          </nav>
        )}

        <article className="min-w-0 flex-1">
          <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground/80">
            <FileText className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{content.document.title || t("untitledPlaceholder")}</span>
          </h1>

          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("common:common.loading")}
            </div>
          )}

          {content.document.content
            ? <MarkdownEditor value={content.document.content} readOnly />
            : <p className="text-sm italic text-muted-foreground/70">{t("field.noContent")}</p>}

          {content.attachments.length > 0 && (
            <AttachmentList
              token={token}
              attachments={content.attachments}
              password={meta.hasPassword ? password : undefined}
            />
          )}
        </article>
      </div>
    </Shell>
  );
}

function rootId(nodes: readonly PublicSubtreeNode[]): string | undefined {
  return nodes.find(n => n.parentId === null)?.id;
}

function PasswordPrompt({
  title,
  value,
  onChange,
  error,
  loading,
  onSubmit,
}: {
  readonly title: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onSubmit: () => void;
}) {
  const { t } = useTranslation("documents");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-5" />
        </div>
        <p className="min-w-0 truncate text-base font-medium">{title}</p>
      </div>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading || !value}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        {t("public.open")}
      </Button>
    </form>
  );
}

interface TreeItem extends PublicSubtreeNode {
  readonly children: TreeItem[];
}

function buildTree(nodes: readonly PublicSubtreeNode[]): TreeItem[] {
  const byId = new Map<string, TreeItem>(nodes.map(n => [n.id, { ...n, children: [] }]));
  const roots: TreeItem[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId !== null ? byId.get(node.parentId) : undefined;
    if (parent)
      parent.children.push(node);
    else
      roots.push(node);
  }
  return roots;
}

function SubtreeNav({
  nodes,
  activeId,
  disabled,
  onSelect,
}: {
  readonly nodes: readonly PublicSubtreeNode[];
  readonly activeId: string | undefined;
  readonly disabled: boolean;
  readonly onSelect: (node: PublicSubtreeNode) => void;
}) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {tree.map(node => (
        <TreeRow key={node.id} node={node} depth={0} activeId={activeId} disabled={disabled} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  depth,
  activeId,
  disabled,
  onSelect,
}: {
  readonly node: TreeItem;
  readonly depth: number;
  readonly activeId: string | undefined;
  readonly disabled: boolean;
  readonly onSelect: (node: PublicSubtreeNode) => void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(node)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/40 disabled:opacity-50",
          node.id === activeId && "bg-accent/60 font-medium",
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.title}</span>
      </button>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map(child => (
            <TreeRow key={child.id} node={child} depth={depth + 1} activeId={activeId} disabled={disabled} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AttachmentList({
  token,
  attachments,
  password,
}: {
  readonly token: string;
  readonly attachments: readonly PublicDocumentAttachment[];
  readonly password: string | undefined;
}) {
  const { t } = useTranslation("documents");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (attachment: PublicDocumentAttachment) => {
    setBusyId(attachment.id);
    setError(null);
    try {
      await openPublicDocumentAttachment(token, attachment, password);
    }
    catch (err) {
      setError(errorMessage(err, t("public.loadError")));
    }
    finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-8 border-t pt-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Paperclip className="size-4 text-muted-foreground" />
        {t("attachments.title")}
      </p>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-1">
        {attachments.map((att) => {
          const inline = att.mimetype.startsWith("image/") || att.mimetype === "application/pdf";
          return (
            <li key={att.id}>
              <button
                type="button"
                disabled={busyId === att.id}
                onClick={() => void open(att)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/40 disabled:opacity-50"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileText className="size-4" />
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">{att.filename}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(att.size)}</span>
                {busyId === att.id
                  ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  : inline
                    ? <Eye className="size-4 shrink-0 text-muted-foreground" />
                    : <Download className="size-4 shrink-0 text-muted-foreground" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
