// Edit dialog for the `ship-profile` section: hull number, vessel lifecycle
// status and the maritime particulars. The project's own name / description /
// status / cover / tags are edited in the project settings dialog, so they are
// deliberately absent here.

import type { ShipProfileFormState } from "./-ship-profile-form-logic";
import type { ShipStatus } from "@/shared/lib/api/project-sections";
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
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { SHIP_STATUSES } from "@/shared/lib/api/project-sections";
import { EMPTY_SHIP_PROFILE_FORM, SHIP_NUMBER_FIELD_RANGES, shipProfileFormNumberErrors } from "./-ship-profile-form-logic";

// Particulars rendered from a config so the markup stays flat. `kind` drives
// the input type; the label comes from `ships:field.*`.
const TEXT_FIELDS = [
  "builder",
  "model",
  "imoNumber",
  "mmsi",
  "callSign",
  "flagState",
  "registryPort",
  "ownerName",
] as const;

const NUMBER_FIELDS = [
  "buildYear",
  "lengthOverall",
  "beam",
  "draft",
  "airDraft",
  "grossTonnage",
] as const;

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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ship-hull-number">{t("field.hullNumber")}</Label>
              <Input
                id="ship-hull-number"
                autoFocus
                value={form.hullNumber}
                onChange={e => set("hullNumber", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ship-status">{t("field.status")}</Label>
              <Select value={form.shipStatus} onValueChange={v => v !== null && set("shipStatus", v as ShipStatus)}>
                <SelectTrigger id="ship-status" className="w-full">
                  <SelectValue>
                    {(v: string) => t(`status.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SHIP_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{t(`status.${s}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {TEXT_FIELDS.map(key => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`ship-${key}`}>{t(`field.${key}` as const)}</Label>
                <Input
                  id={`ship-${key}`}
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                />
              </div>
            ))}

            {NUMBER_FIELDS.map((key) => {
              const range = SHIP_NUMBER_FIELD_RANGES[key];
              const invalid = numberErrors.includes(key);
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`ship-${key}`}>{t(`field.${key}` as const)}</Label>
                  <Input
                    id={`ship-${key}`}
                    type="number"
                    inputMode="decimal"
                    min={range.min}
                    max={range.max}
                    step={key === "buildYear" ? 1 : "any"}
                    aria-invalid={invalid || undefined}
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                  />
                </div>
              );
            })}
          </div>

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
