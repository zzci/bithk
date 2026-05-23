// Rename dialog for a document, driven from the tree row menu. State is
// owned by the sidebar: `target` carries the doc's short id + current
// title. The inner form is keyed by the target id so it re-seeds its
// input on each open without a state-syncing effect.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { useDocument, useUpdateDocument } from "@/shared/lib/api/documents";
import { errorMessage } from "@/shared/lib/errors";

export interface RenameTarget {
  readonly id: string;
  readonly title: string;
}

export function RenameDialog({
  target,
  onOpenChange,
}: {
  readonly target: RenameTarget | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("documents");
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rename.title")}</DialogTitle>
        </DialogHeader>
        {target && (
          <RenameForm
            key={target.id}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  target,
  onDone,
}: {
  readonly target: RenameTarget;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation("documents");
  const updateMutation = useUpdateDocument();
  // The tree node carries the title, but the patch needs the current
  // `version` for optimistic-concurrency — fetch the doc so we submit
  // against a fresh version.
  const docQuery = useDocument(target.id);
  const [value, setValue] = useState(target.title);

  const submit = () => {
    const title = value.trim();
    if (!title) {
      toast.error(t("field.titleRequired"));
      return;
    }
    const version = docQuery.data?.version;
    if (version === undefined)
      return; // Save stays disabled until the version loads.
    updateMutation.mutate(
      { id: target.id, version, title },
      {
        onSuccess: () => onDone(),
        onError: err => toast.error(errorMessage(err, t("common.error.operationFailed"))),
      },
    );
  };

  return (
    <>
      <Input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t("untitledPlaceholder")}
        aria-label={t("field.title")}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline">{t("common.cancel")}</Button>} />
        <Button
          onClick={submit}
          disabled={updateMutation.isPending || docQuery.data === undefined || !value.trim()}
        >
          {t("common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
