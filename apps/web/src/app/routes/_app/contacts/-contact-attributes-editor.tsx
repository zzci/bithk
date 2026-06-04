// Custom key/value attributes editor shared by both contact kinds. Renders the
// form's attribute rows as paired key/value inputs with per-row removal, plus an
// "add" affordance. Purely controlled: it owns no state, mutating the parent's
// ordered row list immutably (rows carry a stable id so React keys never collide
// with positional edits). Serialization to/from the flat Record lives in
// -contact-form-logic.

import type { AttributeRow } from "./-contact-form-logic";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { createAttributeRow } from "./-contact-form-logic";

interface ContactAttributesEditorProps {
  readonly value: readonly AttributeRow[];
  readonly onChange: (rows: readonly AttributeRow[]) => void;
}

export function ContactAttributesEditor({ value, onChange }: ContactAttributesEditorProps) {
  const { t } = useTranslation("contacts");

  const update = (id: string, patch: Partial<Pick<AttributeRow, "key" | "value">>) =>
    onChange(value.map(row => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: string) => onChange(value.filter(row => row.id !== id));
  const add = () => onChange([...value, createAttributeRow()]);

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("field.attributes")}</Label>
      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map(row => (
            <li key={row.id} className="flex items-center gap-2">
              <Input
                aria-label={t("attributes.keyLabel")}
                placeholder={t("attributes.keyPlaceholder")}
                value={row.key}
                onChange={e => update(row.id, { key: e.target.value })}
                className="flex-1"
              />
              <Input
                aria-label={t("attributes.valueLabel")}
                placeholder={t("attributes.valuePlaceholder")}
                value={row.value}
                onChange={e => update(row.id, { value: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("attributes.remove")}
                onClick={() => remove(row.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X data-icon="inline" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
        <Plus data-icon="inline" />
        {t("attributes.add")}
      </Button>
    </div>
  );
}
