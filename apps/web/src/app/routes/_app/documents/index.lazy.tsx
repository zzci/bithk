/* eslint-disable react-refresh/only-export-components */
import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, Pin } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentTree } from "@/shared/lib/api/documents";
import { EmptyState } from "../-documents-create";

export const Route = createLazyFileRoute("/_app/documents/")({
  component: DocumentsIndex,
});

function DocumentsIndex() {
  const { t } = useTranslation("documents");
  const navigate = useNavigate();
  // Shares the cached tree query the layout already loaded — no extra
  // request. Pinned state is per-user and lives on each node.
  const treeQuery = useDocumentTree();
  const pinned = useMemo(
    () =>
      (treeQuery.data ?? [])
        .filter(n => n.pinned)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [treeQuery.data],
  );

  // No pins yet → keep the original prompt-to-create empty state.
  if (pinned.length === 0)
    return <EmptyState onCreate={() => void navigate({ to: "/documents/new" })} />;

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-8">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-muted-foreground">
        <Pin className="size-4 fill-current" strokeWidth={1.75} />
        {t("pinned.title")}
      </h2>
      <ul className="flex flex-col gap-1">
        {pinned.map(node => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => void navigate({ to: "/documents/$docId", params: { docId: node.id } })}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
