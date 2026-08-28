// The `ship-profile` section's field grid: hull number, vessel lifecycle
// status and the maritime particulars, rendered from the shared field lists in
// `-ship-profile-form-logic.ts`.
//
// Shared by the edit dialog (`-ship-profile-form-dialog.tsx`) and the create
// dialog's ship preset (`-project-form-dialog.tsx`) so both surfaces offer the
// same fields under the same validation instead of drifting apart.

import type { ShipNumberField, ShipProfileFormState } from "./-ship-profile-form-logic";
import type { ShipStatus } from "@/shared/lib/api/project-sections";
import { useId } from "react";
import { useTranslation } from "react-i18next";
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
import { SHIP_NUMBER_FIELD_RANGES, SHIP_NUMBER_FIELDS, SHIP_TEXT_FIELDS } from "./-ship-profile-form-logic";

interface ShipProfileFieldsProps {
  readonly form: ShipProfileFormState;
  readonly onChange: <K extends keyof ShipProfileFormState>(key: K, value: ShipProfileFormState[K]) => void;
  /** Numeric fields currently out of range; rendered as `aria-invalid`. */
  readonly numberErrors: readonly ShipNumberField[];
  readonly autoFocusHullNumber?: boolean;
}

export function ShipProfileFields({ form, onChange, numberErrors, autoFocusHullNumber }: ShipProfileFieldsProps) {
  const { t } = useTranslation("ships");
  // Both dialogs can mount their own copy of this grid; a generated prefix
  // keeps every label/control pair unambiguous.
  const fieldId = useId();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-hullNumber`}>{t("field.hullNumber")}</Label>
        <Input
          id={`${fieldId}-hullNumber`}
          autoFocus={autoFocusHullNumber}
          value={form.hullNumber}
          onChange={e => onChange("hullNumber", e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-shipStatus`}>{t("field.status")}</Label>
        <Select value={form.shipStatus} onValueChange={v => v !== null && onChange("shipStatus", v as ShipStatus)}>
          <SelectTrigger id={`${fieldId}-shipStatus`} className="w-full">
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

      {SHIP_TEXT_FIELDS.map(key => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`${fieldId}-${key}`}>{t(`field.${key}` as const)}</Label>
          <Input
            id={`${fieldId}-${key}`}
            value={form[key]}
            onChange={e => onChange(key, e.target.value)}
          />
        </div>
      ))}

      {SHIP_NUMBER_FIELDS.map((key) => {
        const range = SHIP_NUMBER_FIELD_RANGES[key];
        const invalid = numberErrors.includes(key);
        return (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`${fieldId}-${key}`}>{t(`field.${key}` as const)}</Label>
            <Input
              id={`${fieldId}-${key}`}
              type="number"
              inputMode="decimal"
              min={range.min}
              max={range.max}
              step={key === "buildYear" ? 1 : "any"}
              aria-invalid={invalid || undefined}
              value={form[key]}
              onChange={e => onChange(key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
