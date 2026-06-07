// Generic attachments UI for any resource exposing
// `/api/{resource}/{id}/attachments` (+ `?inline=true` for preview).
// Lists the resource's attachments as a compact grid of cards with
// inline preview (image / PDF / text) and delete confirmation. Upload
// is intentionally owned by the parent — this section is display-only.

import type { DriveEntry } from "@/shared/lib/api/drive";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FilePreviewDialog, resolvePreviewKind } from "@/shared/components/file";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes, formatDate } from "@/shared/lib/format";
import { BASE_PATH, http } from "@/shared/lib/http";

import { attachmentsQueryKey } from "./attachment-utils";

export interface ResourceAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimetype: string;
  readonly size: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

export interface ResourceAttachmentSectionProps {
  /** Path prefix, e.g. "documents" or "issues". */
  readonly resource: string;
  readonly resourceId: string;
  readonly canDelete: (att: ResourceAttachment) => boolean;
  readonly i18nNs: string;
}

export function ResourceAttachmentSection({
  resource,
  resourceId,
  canDelete,
  i18nNs,
}: ResourceAttachmentSectionProps) {
  const { t } = useTranslation(i18nNs);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResourceAttachment | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ResourceAttachment | null>(null);

  const attachmentsQuery = useQuery({
    queryKey: attachmentsQueryKey(resource, resourceId),
    queryFn: () => http<{ data: ResourceAttachment[] }>(`/${resource}/${resourceId}/attachments`).then(r => r.data),
  });
  const attachments = attachmentsQuery.data ?? [];

  const remove = useMutation({
    mutationFn: async (att: ResourceAttachment) => {
      await http(`/${resource}/${resourceId}/attachments/${att.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: attachmentsQueryKey(resource, resourceId) });
    },
    onError: err => setError(errorMessage(err, t("common.error.deleteFailed"))),
  });

  const handleDownload = (att: ResourceAttachment) => {
    const a = document.createElement("a");
    a.href = `${BASE_PATH}/api/${resource}/${resourceId}/attachments/${att.id}`;
    a.download = att.filename;
    a.click();
  };

  // Render-nothing when no attachments — callers decide whether to show
  // a header above this section based on the same shared query.
  if (attachments.length === 0 && !attachmentsQuery.isLoading)
    return null;

  return (
    <div>
      <ErrorBanner message={error} className="mb-2" />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {attachmentsQuery.isLoading
          ? null
          : attachments.map((att) => {
              const isImage = att.mimetype.startsWith("image/");
              const inlineUrl = `${BASE_PATH}/api/${resource}/${resourceId}/attachments/${att.id}?inline=true`;
              const canPreview = resolvePreviewKind(att.mimetype, att.filename) !== "unsupported";
              return (
                <div
                  key={att.id}
                  className="group relative flex h-12 cursor-pointer items-center gap-2 overflow-hidden rounded-md border bg-card pr-2 transition-colors hover:bg-accent/20"
                  onClick={() => (canPreview ? setPreviewTarget(att) : handleDownload(att))}
                  title={att.filename}
                >
                  {isImage
                    ? (
                        <div
                          className="size-12 shrink-0 bg-cover bg-center"
                          style={{ backgroundImage: `url(${inlineUrl})` }}
                        />
                      )
                    : (
                        <div className="flex size-12 shrink-0 items-center justify-center bg-muted/30">
                          <FileUp className="size-4 text-muted-foreground/60" strokeWidth={1.5} />
                        </div>
                      )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
                    <div className="truncate text-xs font-medium leading-tight">{att.filename}</div>
                    <div className="truncate text-2xs text-muted-foreground">
                      {formatBytes(att.size)}
                      <span className="mx-1 text-muted-foreground/50">·</span>
                      {formatDate(att.createdAt)}
                    </div>
                  </div>
                  <div className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(att);
                      }}
                      title={t("attachments.download")}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    {canDelete(att) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(att);
                        }}
                        title={t("common.delete")}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("attachments.deleteTitle")}
        description={t("attachments.deleteConfirm", { filename: deleteTarget?.filename })}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />

      {previewTarget && (
        <FilePreviewDialog
          entry={attachmentToEntry(previewTarget)}
          open
          readOnly
          fetchContent={(signal) => {
            // Direct fetch (not `httpRaw`): the attachment endpoint may 302 to
            // a cross-origin presigned URL, and this is a read-only GET with no
            // CSRF surface.
            const url = `${BASE_PATH}/api/${resource}/${resourceId}/attachments/${previewTarget.id}?inline=true`;
            return fetch(url, { credentials: "include", signal }).then((res) => {
              if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
              return res.blob();
            });
          }}
          onDownload={() => handleDownload(previewTarget)}
          onOpenChange={open => !open && setPreviewTarget(null)}
        />
      )}
    </div>
  );
}

/** Minimal `DriveEntry` the shared viewer needs; bytes come from a fetch override. */
function attachmentToEntry(att: ResourceAttachment): DriveEntry {
  return {
    id: att.id,
    ownerType: "user",
    ownerId: "",
    parentEntryId: null,
    type: "file",
    name: att.filename,
    favorite: false,
    status: "normal",
    createdBy: "",
    createdByName: "",
    createdAt: "",
    updatedAt: "",
    file: { referenceId: "", fileId: "", filename: att.filename, mimetype: att.mimetype, size: att.size },
  };
}
