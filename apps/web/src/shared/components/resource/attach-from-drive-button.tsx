// "Choose from Drive" attach affordance. Opens the shared DriveFilePicker and
// attaches the picked drive entry to a resource through the backend from-drive
// route — the server records a reference to the already-stored file, so there
// is no blob re-upload. Sits next to a resource's regular upload control and
// refreshes the same attachments query on success.

import type { DriveEntry } from "@/shared/lib/api/drive";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DriveFilePicker } from "@/app/routes/_app/-drive-file-picker";
import { Button } from "@/shared/components/ui/button";
import { http, HttpError } from "@/shared/lib/http";

import { attachmentsQueryKey } from "./attachment-utils";

interface AttachFromDriveButtonProps {
  readonly resource: string;
  readonly resourceId: string;
  readonly onError?: (err: unknown) => void;
}

export function AttachFromDriveButton({ resource, resourceId, onError }: AttachFromDriveButtonProps) {
  const { t } = useTranslation("common");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const attach = useMutation({
    mutationFn: (entry: DriveEntry) =>
      http(`/${resource}/${resourceId}/attachments/from-drive`, {
        method: "POST",
        body: JSON.stringify({ entryId: entry.id }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: attachmentsQueryKey(resource, resourceId) });
      setOpen(false);
    },
    onError: (err) => {
      // A file already referenced by this resource comes back as a duplicate
      // reference — surface a friendly, specific message instead of the
      // generic upload-failed fallback. Other errors flow through untouched.
      onError?.(
        err instanceof HttpError && err.code === "DUPLICATE_REFERENCE"
          ? new Error(t("upload.alreadyAttached"))
          : err,
      );
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        disabled={attach.isPending}
        title={t("upload.chooseFromDrive")}
      >
        <HardDrive className="size-3" />
        {t("upload.chooseFromDrive")}
      </Button>
      {/* Mount the picker only while open so its drive-entries query stays idle
          until the user actually browses (and so resource panels that never
          open it pay nothing for it). */}
      {open && (
        <DriveFilePicker
          open
          onOpenChange={setOpen}
          onPick={entry => attach.mutate(entry)}
        />
      )}
    </>
  );
}
