// Create / edit ship dialog. Used by the list page (create) and the Overview
// tab (edit). Only the name is required; the API auto-generates a hull number
// when the code is blank. The descriptive vessel particulars are shown in edit
// mode only — create stays minimal.

import type { ShipFormState } from "./-ship-form-logic";
import type { ShipStatus, ShipView } from "@/shared/lib/api/ships";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TagInput } from "@/shared/components/tags";
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
import { Textarea } from "@/shared/components/ui/textarea";
import { SHIP_STATUSES, useShipTags } from "@/shared/lib/api/ships";
import { EMPTY_SHIP_FORM, SHIP_NUMBER_FIELD_RANGES, shipFormFromView, shipFormNumberErrors } from "./-ship-form-logic";

// Descriptive (edit-only) fields, rendered from a config so the markup stays
// flat. `kind` drives the input type; the label comes from `ships:field.*`.
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

interface ShipFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial?: ShipView;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit: (state: ShipFormState) => void;
}

export function ShipFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  errorMessage,
  onSubmit,
}: ShipFormDialogProps) {
  const { t } = useTranslation(["ships", "common"]);
  const [form, setForm] = useState<ShipFormState>(EMPTY_SHIP_FORM);
  const shipTags = useShipTags().data ?? [];

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the
     dialog opens so a previous draft never leaks into the next submission. */
  useEffect(() => {
    if (!open)
      return;
    setForm(initial ? shipFormFromView(initial) : EMPTY_SHIP_FORM);
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ShipFormState>(key: K, value: ShipFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const numberErrors = shipFormNumberErrors(form);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || pending || numberErrors.length > 0)
      return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("form.createTitle") : t("form.editTitle")}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("form.createDescription") : t("form.editDescription")}
            </DialogDescription>
          </DialogHeader>

          {errorMessage && <ErrorBanner message={errorMessage} />}

          <div className="space-y-1.5">
            <Label htmlFor="ship-name">{t("field.name")}</Label>
            <Input
              id="ship-name"
              autoFocus
              required
              value={form.name}
              onChange={e => set("name", e.target.value)}
              placeholder={t("form.namePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ship-code">{t("field.code")}</Label>
            <Input
              id="ship-code"
              value={form.code}
              onChange={e => set("code", e.target.value)}
              placeholder={t("form.codePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ship-status">{t("field.status")}</Label>
            <Select value={form.status} onValueChange={v => v !== null && set("status", v as ShipStatus)}>
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

          <div className="space-y-1.5">
            <Label>{t("field.tags")}</Label>
            <TagInput
              value={form.tags}
              onChange={tags => set("tags", tags)}
              suggestions={shipTags.map(tag => tag.name)}
              namespace="ships"
            />
          </div>

          {mode === "edit" && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <div className="space-y-1.5">
                <Label htmlFor="ship-description">{t("field.description")}</Label>
                <Textarea
                  id="ship-description"
                  value={form.description}
                  onChange={e => set("description", e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim() || numberErrors.length > 0}>
              {mode === "create" ? t("form.submitCreate") : t("form.submitSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
