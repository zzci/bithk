// Linear-style tag picker. Selected tags render as removable TagChips; a dashed
// "Tags" pill opens a popup with a search box that lists the existing tag
// vocabulary and (when `allowCreate`) offers to create a new tag from the typed
// query. Values are plain tag names. `namespace` selects the i18n namespace that
// supplies the (identical) `field.tags` + `tags.*` labels. Subsumes
// tags-combobox.tsx and the per-domain tags-combobox wrappers.

import { TagIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/components/ui/combobox";
import { TagChip } from "./tag-chip";

export interface TagInputProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly suggestions?: readonly string[];
  /** i18n namespace providing `field.tags` + `tags.*` (projects / ships share identical values). */
  readonly namespace?: string;
  readonly allowCreate?: boolean;
}

export function TagInput({ value, onChange, suggestions = [], namespace = "projects", allowCreate = true }: TagInputProps) {
  const { t } = useTranslation(namespace);
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  // Show every matching suggestion (selected ones included, with a check) so the
  // list works as a multi-select toggle.
  const matches = suggestions.filter(s => s.toLowerCase().includes(q));
  const canCreate
    = allowCreate
      && trimmed.length > 0
      && !suggestions.some(s => s.toLowerCase() === q)
      && !value.some(v => v.toLowerCase() === q);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map(tag => (
        <TagChip
          key={tag}
          label={tag}
          removable
          removeLabel={t("tags.remove", { name: tag })}
          onRemove={() => onChange(value.filter(v => v !== tag))}
        />
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
