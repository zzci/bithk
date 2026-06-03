// Public, view-only document share preview: Markdown body + navigable subtree
// + attachments. A link on a folder document grants the same view-only access
// to every descendant; the returned subtree is navigable on the same token.

import type {
  PublicDocumentAttachment,
  PublicDocumentContent,
  PublicDocumentNode,
  PublicShareMeta,
} from "@/shared/lib/api/share";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownEditor } from "@/shared/components/editor";
import { Button } from "@/shared/components/ui/button";
import { accessPublicShare, fetchPublicShareChild } from "@/shared/lib/api/share";
import { errorMessage } from "@/shared/lib/errors";
import { HttpError } from "@/shared/lib/http";
import { cn } from "@/shared/lib/utils";

import { formatBytes } from "../share-helpers";
import { PasswordPrompt, ShareShell, ShareStatus } from "./shell";

export function DocumentPublicPreview({ meta, token }: { readonly meta: PublicShareMeta; readonly token: string }) {
  const { t } = useTranslation("share");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!meta.requiresPassword);
  const [content, setContent] = useState<PublicDocumentContent | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (childId: string | undefined, pwd: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await accessPublicShare<PublicDocumentContent>(token, {
        password: meta.requiresPassword ? pwd : undefined,
        childId,
      });
      setContent(data);
      setActiveChildId(childId);
      setUnlocked(true);
      setAuthError(null);
    }
    catch (err) {
      if (err instanceof HttpError && err.status === 403) {
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
  }, [token, meta.requiresPassword, t]);

  useEffect(() => {
    if (unlocked && !content)
      void load(undefined, password);
    // eslint-disable-next-line react/exhaustive-deps -- password captured intentionally; loads driven by unlock + navigation.
  }, [unlocked]);

  if (!unlocked) {
    return (
      <ShareShell>
        <PasswordPrompt
          icon={<FileText className="size-5" />}
          name={meta.name}
          value={password}
          onChange={setPassword}
          error={authError}
          loading={loading}
          onSubmit={() => void load(undefined, password)}
        />
      </ShareShell>
    );
  }

  if (loading && !content) {
    return (
      <ShareShell wide>
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          {t("common:common.loading")}
        </div>
      </ShareShell>
    );
  }

  if (error && !content)
    return <ShareShell><ShareStatus icon={<FileText className="size-8 text-destructive" />} title={error} /></ShareShell>;

  if (!content)
    return <ShareShell><ShareStatus icon={<FileText className="size-8 text-destructive" />} title={t("public.notFound")} /></ShareShell>;

  const hasSubtree = content.subtree.length > 1;

  return (
    <ShareShell wide>
      <div className={cn("flex flex-col gap-6", hasSubtree && "md:flex-row md:gap-8")}>
        {hasSubtree && (
          <nav className="shrink-0 md:w-56 md:border-r md:pr-4">
            <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("public.contents")}
            </p>
            <SubtreeNav
              nodes={content.subtree}
              activeId={activeChildId ?? rootId(content.subtree)}
              disabled={loading}
              onSelect={(node) => {
                if (node.id !== (activeChildId ?? rootId(content.subtree)))
                  void load(node.parentId === null ? undefined : node.id, password);
              }}
            />
          </nav>
        )}

        <article className="min-w-0 flex-1">
          <h1 className="mb-4 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground/80">
            <FileText className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{content.document.title || t("public.untitled")}</span>
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
            : <p className="text-sm italic text-muted-foreground/70">{t("public.noContent")}</p>}

          {content.attachments.length > 0 && (
            <AttachmentList
              token={token}
              attachments={content.attachments}
              password={meta.requiresPassword ? password : undefined}
            />
          )}
        </article>
      </div>
    </ShareShell>
  );
}

function rootId(nodes: readonly PublicDocumentNode[]): string | undefined {
  return nodes.find(n => n.parentId === null)?.id;
}

interface TreeItem extends PublicDocumentNode {
  readonly children: TreeItem[];
}

function buildTree(nodes: readonly PublicDocumentNode[]): TreeItem[] {
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
  readonly nodes: readonly PublicDocumentNode[];
  readonly activeId: string | undefined;
  readonly disabled: boolean;
  readonly onSelect: (node: PublicDocumentNode) => void;
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
  readonly onSelect: (node: PublicDocumentNode) => void;
}) {
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => onSelect(node)}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          "h-auto w-full justify-start gap-2 rounded-md py-1.5 pr-2 text-left font-normal transition-colors hover:bg-accent/40",
          node.id === activeId && "bg-accent/60 font-medium",
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.title}</span>
      </Button>
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

/** Open one attachment: images/PDFs inline in a new tab, everything else downloads. */
async function openAttachment(token: string, attachment: PublicDocumentAttachment, password: string | undefined): Promise<void> {
  const inline = attachment.mimetype.startsWith("image/") || attachment.mimetype === "application/pdf";
  const res = await fetchPublicShareChild(token, attachment.id, password);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (inline) {
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = attachment.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  const { t } = useTranslation("share");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (attachment: PublicDocumentAttachment) => {
    setBusyId(attachment.id);
    setError(null);
    try {
      await openAttachment(token, attachment, password);
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
        {t("public.attachments")}
      </p>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-1">
        {attachments.map(att => (
          <li key={att.id}>
            <Button
              type="button"
              variant="ghost"
              disabled={busyId === att.id}
              onClick={() => void open(att)}
              className="h-auto w-full justify-start gap-3 rounded-md px-2 py-2 text-left font-normal transition-colors hover:bg-accent/40"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <FileText className="size-4" />
              </div>
              <span className="min-w-0 flex-1 truncate text-sm">{att.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(att.size)}</span>
              {busyId === att.id && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
