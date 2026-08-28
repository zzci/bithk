// Create project dialog (Linear-style). Only the name is required; the
// description and tags are optional. The project code and status are not set
// here — the backend auto-generates the code (`P-<id>`) and defaults the status
// to "active" (a freshly created project is never archived).
//
// The dialog also picks the project's PRESET (PLAN-108): which sections the new
// project mounts. "General" mounts issues / procurement / files; "Ship" adds
// the maritime sections and reveals the `ship-profile` fields, submitted as
// `sectionData["ship-profile"]`. The hull number may be left blank — the API
// generates one from the project's short id.
//
// Layout note: the dialog manages its own padding (`p-0` on the content) and
// uses a custom bordered footer rather than the shared `DialogFooter`, which
// bleeds with negative margins that assume the default `p-4` content padding.

import type { ShipProfileFormState } from "./-ship-profile-form-logic";
import type { CreateProjectInput, ProjectPreset } from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TagInput } from "@/shared/components/tags";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Textarea } from "@/shared/components/ui/textarea";
import { DEFAULT_PROJECT_PRESET } from "@/shared/lib/api/projects";
import { ShipProfileFields } from "./-ship-profile-fields";
import { EMPTY_SHIP_PROFILE_FORM, shipProfileFormNumberErrors, shipProfileFormToUpdate } from "./-ship-profile-form-logic";

// Offered presets, in display order. Mirrors `PROJECT_PRESETS`; only the ship
// preset contributes extra create-time fields.
const PRESETS: readonly ProjectPreset[] = ["general", "ship"];

interface ProjectFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly availableTags?: readonly string[];
  readonly onSubmit: (values: CreateProjectInput) => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  pending,
  errorMessage,
  availableTags = [],
  onSubmit,
}: ProjectFormDialogProps) {
  const { t } = useTranslation(["projects", "ships", "common"]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<readonly string[]>([]);
  const [preset, setPreset] = useState<ProjectPreset>(DEFAULT_PROJECT_PRESET);
  const [shipForm, setShipForm] = useState<ShipProfileFormState>(EMPTY_SHIP_PROFILE_FORM);

  /* eslint-disable react/set-state-in-effect -- reset the form fields whenever
     the dialog opens so a previous draft never leaks into a new project. */
  useEffect(() => {
    if (!open)
      return;
    setName("");
    setDescription("");
    setTags([]);
    setPreset(DEFAULT_PROJECT_PRESET);
    setShipForm(EMPTY_SHIP_PROFILE_FORM);
  }, [open]);
  /* eslint-enable react/set-state-in-effect */

  const setShipField = <K extends keyof ShipProfileFormState>(key: K, value: ShipProfileFormState[K]) =>
    setShipForm(prev => ({ ...prev, [key]: value }));

  const isShip = preset === "ship";
  // Only the ship preset's own fields can be out of range; a general project
  // never blocks on them even if a draft was typed before switching back.
  const numberErrors = isShip ? shipProfileFormNumberErrors(shipForm) : [];
  const canSubmit = !!name.trim() && !pending && numberErrors.length === 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit)
      return;
    const values: CreateProjectInput = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      preset,
      // `shipProfileFormToUpdate` omits a blank hull number, so the API's
      // auto-generated one stands; every other blank clears to null.
      ...(isShip ? { sectionData: { "ship-profile": shipProfileFormToUpdate(shipForm) } } : {}),
    };
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogTitle className="sr-only">{t("create.title")}</DialogTitle>

          <div className="max-h-[70svh] space-y-2 overflow-y-auto px-6 pt-6 pb-4">
            {errorMessage && <ErrorBanner message={errorMessage} />}

            <Input
              aria-label={t("field.name")}
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              className="h-auto border-0 bg-transparent px-0 py-0 text-lg font-semibold shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            />

            <Textarea
              aria-label={t("field.description")}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={3}
              className="min-h-16 resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            />

            <div className="pt-2">
              <TagInput value={tags} onChange={setTags} suggestions={availableTags} />
            </div>

            <div className="space-y-1.5 pt-2">
              <Label>{t("create.presetLabel")}</Label>
              <RadioGroup
                value={preset}
                onValueChange={v => v !== null && setPreset(v as ProjectPreset)}
                aria-label={t("create.presetLabel")}
                className="flex flex-wrap gap-x-4 gap-y-1"
              >
                {PRESETS.map(value => (
                  <RadioGroupItem key={value} value={value}>
                    <span className="text-sm">{t(value === "ship" ? "create.presetShip" : "create.presetGeneral")}</span>
                  </RadioGroupItem>
                ))}
              </RadioGroup>
            </div>

            {isShip && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-xs font-medium text-muted-foreground">{t("create.shipParticulars")}</p>
                <ShipProfileFields form={shipForm} onChange={setShipField} numberErrors={numberErrors} />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t bg-muted/30 px-6 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t("create.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
