// Edit dialog for the `ship-profile` section: hull number, vessel lifecycle
// status and the maritime particulars. The project's own name / description /
// status / cover / tags are edited in the project settings dialog, so they are
// deliberately absent here.

import type { ShipProfileFormState } from "./-ship-profile-form-logic";
import { useEffect, useState } from "react";
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
import { ShipProfileFields } from "./-ship-profile-fields";
import { EMPTY_SHIP_PROFILE_FORM, shipProfileFormNumberErrors } from "./-ship-profile-form-logic";

interface ShipProfileFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initial: ShipProfileFormState;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit: (state: ShipProfileFormState) => void;
}

export function ShipProfileFormDialog({
  open,
  onOpenChange,
  initial,
  pending,
  errorMessage,
  onSubmit,
}: ShipProfileFormDialogProps) {
  const { t } = useTranslation(["ships", "common"]);
  const [form, setForm] = useState<ShipProfileFormState>(EMPTY_SHIP_PROFILE_FORM);

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the
     dialog opens so a previous draft never leaks into the next submission. */
  useEffect(() => {
    if (open)
      setForm(initial);
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ShipProfileFormState>(key: K, value: ShipProfileFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const numberErrors = shipProfileFormNumberErrors(form);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || numberErrors.length > 0)
      return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("form.editTitle")}</DialogTitle>
            <DialogDescription>{t("form.editDescription")}</DialogDescription>
          </DialogHeader>

          {errorMessage && <ErrorBanner message={errorMessage} />}

          <ShipProfileFields form={form} onChange={set} numberErrors={numberErrors} autoFocusHullNumber />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || numberErrors.length > 0}>
              {t("form.submitSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
