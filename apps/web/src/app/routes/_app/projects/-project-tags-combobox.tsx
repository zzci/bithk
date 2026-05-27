// Multi-select tag picker for the create-project dialog: lists the existing
// global tag vocabulary and lets the user create a brand-new tag inline.
// Values are plain tag names — the create-project API accepts names directly.
//
// Filtering is done here (not via base-ui's `items` prop) so an extra
// "create" entry can be appended for any unmatched query.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/shared/components/ui/combobox";

interface ProjectTagsComboboxProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly suggestions: readonly string[];
}

export function ProjectTagsCombobox({ value, onChange, suggestions }: ProjectTagsComboboxProps) {
  const { t } = useTranslation("projects");
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  const matches = suggestions.filter(
    s => !value.some(v => v.toLowerCase() === s.toLowerCase()) && s.toLowerCase().includes(q),
  );
  const canCreate
    = trimmed.length > 0
      && !suggestions.some(s => s.toLowerCase() === q)
      && !value.some(v => v.toLowerCase() === q);

  return (
    <Combobox
      multiple
      value={value as string[]}
      onValueChange={next => onChange(next)}
      onInputValueChange={setQuery}
    >
      <ComboboxChips>
        <ComboboxValue>
          {(selected: string[]) => (
            <>
              {selected.map(tag => (
                <ComboboxChip key={tag}>{tag}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder={t("tags.searchPlaceholder")} />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>{t("tags.empty")}</ComboboxEmpty>
        <ComboboxList>
          {matches.map(tag => (
            <ComboboxItem key={tag} value={tag}>{tag}</ComboboxItem>
          ))}
          {canCreate && (
            <ComboboxItem value={trimmed}>{t("tags.create", { name: trimmed })}</ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
