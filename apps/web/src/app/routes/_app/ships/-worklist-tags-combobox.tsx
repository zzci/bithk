// Thin adapter over the shared `TagsCombobox` for worklist tags. Mirrors
// `-ship-tags-combobox.tsx`: the tag picker implementation lives in
// `shared/components/tags-combobox.tsx`. The `ships` i18n namespace supplies the
// shared `field.tags` + `tags.*` labels. Values are plain tag NAMES — the
// worklist create/update APIs accept names. The worklist tag vocabulary is
// fetched separately via `useWorklistTags()`.

import { TagsCombobox } from "@/shared/components/tags-combobox";

interface WorklistTagsComboboxProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly availableTags: readonly string[];
}

export function WorklistTagsCombobox({ value, onChange, availableTags }: WorklistTagsComboboxProps) {
  return <TagsCombobox value={value} onChange={onChange} suggestions={availableTags} namespace="ships" />;
}
