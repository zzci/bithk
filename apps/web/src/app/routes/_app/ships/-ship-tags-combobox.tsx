// Tag picker for the create/edit ship dialog. Ship-local mirror of the project
// tags combobox: selected tags render as removable chips; a dashed "Tags" pill
// opens a popup with a search box over the existing ship tag vocabulary and
// offers to create a new tag from the typed query. Values are plain tag names —
// the create/update API accepts names.

import { TagIcon, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/components/ui/combobox";

interface ShipTagsComboboxProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly availableTags: readonly string[];
}

export function ShipTagsCombobox({ value, onChange, availableTags }: ShipTagsComboboxProps) {
  const { t } = useTranslation("ships");
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  // Show every matching suggestion (selected ones included, with a check) so the
  // list works as a multi-select toggle.
  const matches = availableTags.filter(s => s.toLowerCase().includes(q));
  const canCreate
    = trimmed.length > 0
      && !availableTags.some(s => s.toLowerCase() === q)
      && !value.some(v => v.toLowerCase() === q);

  const remove = (tag: string) => onChange(value.filter(v => v !== tag));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map(tag => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs font-normal">
          {tag}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("tags.remove", { name: tag })}
            onClick={() => remove(tag)}
            className="-mr-0.5 rounded-sm hover:text-destructive"
          >
            <X className="size-3" />
          </Button>
        </Badge>
      ))}

      <Combobox
        multiple
        value={value as string[]}
        onValueChange={next => onChange(next)}
        onInputValueChange={setQuery}
      >
        <ComboboxTrigger className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <TagIcon className="size-3.5" aria-hidden="true" />
          {t("field.tags")}
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput showTrigger={false} placeholder={t("tags.searchPlaceholder")} />
          <ComboboxList>
            {matches.length === 0 && !canCreate && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("tags.empty")}</p>
            )}
            {matches.map(tag => (
              <ComboboxItem key={tag} value={tag}>{tag}</ComboboxItem>
            ))}
            {canCreate && (
              <ComboboxItem value={trimmed}>{t("tags.create", { name: trimmed })}</ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
