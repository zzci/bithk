// Builds the tag filter dimension for ListFilter. Returns a "multi" dimension
// mapping each tag to a {value: id, label: name} option, or null when there are
// no tags — the consistent hide-when-empty rule. Consumers spread
// `...(dim ? [dim] : [])` into their ListFilter `dimensions` array.

import type { FilterDimension } from "@/shared/components/list-filter";

export interface TagFilterArgs {
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  readonly value: readonly string[];
  readonly onChange: (value: string[]) => void;
  /** Caller passes `t("field.tags")`. */
  readonly label: string;
}

export function tagFilterDimension(args: TagFilterArgs): FilterDimension | null {
  if (args.tags.length === 0)
    return null;
  return {
    key: "tags",
    label: args.label,
    mode: "multi",
    value: args.value,
    onChange: args.onChange,
    options: args.tags.map(t => ({ value: t.id, label: t.name })),
  };
}
