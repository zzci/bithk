import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  pending = false,
  confirmLabel,
  cancelLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly onConfirm: () => void;
  readonly pending?: boolean;
  readonly confirmLabel?: ReactNode;
  readonly cancelLabel?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button type="button" variant="outline">{cancelLabel ?? t("common.cancel")}</Button>} />
          {/* Confirm is a plain action, not a Close: the parent keeps the
              dialog open until its mutation resolves, then closes via
              onOpenChange — closing here would dismiss before the result. */}
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel ?? t("common.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
