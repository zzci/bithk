// Presentational create/edit dialog shell for the admin CRUD vocabularies
// (tags, categories, worklists, manufacturers). Wraps the shared `Dialog`
// primitive with the repeated header / error banner / footer chrome; the caller
// supplies the actual field JSX as `children` and owns all data, mutations,
// toasts, and validation. The mode only selects which of the two title strings
// to show — both are passed in already translated. Save/Cancel labels resolve
// from the `common` namespace.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";

interface CrudDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly createTitle: string;
  readonly editTitle: string;
  readonly description: string;
  /** Already-resolved error message; `null`/`undefined` renders nothing. */
  readonly errorMessage?: string | null;
  readonly pending: boolean;
  /** Disables the save button (validation + pending live in the caller). */
  readonly submitDisabled: boolean;
  readonly onSubmit: (event: React.FormEvent) => void;
  /** Field JSX supplied by the caller. */
  readonly children: ReactNode;
  /** Optional override for the dialog content sizing (e.g. taller/wider forms). */
  readonly contentClassName?: string;
  /** Skip native form validation (callers doing manual required-field UI). */
  readonly noValidate?: boolean;
}

export function CrudDialog({
  open,
  onOpenChange,
  mode,
  createTitle,
  editTitle,
  description,
  errorMessage,
  pending,
  submitDisabled,
  onSubmit,
  children,
  contentClassName,
  noValidate,
}: CrudDialogProps) {
  const { t } = useTranslation("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate={noValidate}>
          <DialogHeader>
            <DialogTitle>{mode === "create" ? createTitle : editTitle}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <ErrorBanner message={errorMessage} />

          {children}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || submitDisabled}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
