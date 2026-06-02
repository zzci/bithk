// Thin adapter over the shared `TagsCombobox` (ships i18n namespace), retained
// so the ship form keeps its import path and `availableTags` prop name. The tag
// picker implementation is no longer duplicated here — see
// `shared/components/tags-combobox.tsx`.

import { TagsCombobox } from "@/shared/components/tags-combobox";

interface ShipTagsComboboxProps {
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
  readonly availableTags: readonly string[];
}

export function ShipTagsCombobox({ value, onChange, availableTags }: ShipTagsComboboxProps) {
  return <TagsCombobox value={value} onChange={onChange} suggestions={availableTags} namespace="ships" />;
}
