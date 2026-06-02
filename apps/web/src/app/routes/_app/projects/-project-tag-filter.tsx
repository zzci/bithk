// Tag filter shared by the projects list (single-select) and the project
// issues / procurement tabs (multi-select). Renders a single selector control
// that lists every tag with a checkable state, followed by the selected tags as
// chips to its right.
//
// Single-select uses a DropdownMenu; multi-select uses a searchable Combobox
// that shows the checked state per tag and diffs its value array down to a
// single `onToggle` per change.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

interface BaseProps {
  // Tags in most-used-first order (as returned by the API).
  readonly tags: readonly ProjectTag[];
  readonly className?: string;
}

interface SingleSelectProps extends BaseProps {
  readonly multiple?: false;
  readonly selectedTagId: string | null;
  readonly onSelect: (tagId: string) => void;
}

interface MultiSelectProps extends BaseProps {
  readonly multiple: true;
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
}

type ProjectTagFilterProps = SingleSelectProps | MultiSelectProps;

interface RemovableChipProps {
  readonly tag: ProjectTag;
  readonly onRemove: (tagId: string) => void;
}

// A selected tag rendered as a chip with an X button that deselects it.
function RemovableChip({ tag, onRemove }: RemovableChipProps) {
  const { t } = useTranslation("projects");
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md bg-muted py-1 pr-1 pl-2.5 text-xs font-medium">
      {tag.name}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("tags.remove", { name: tag.name })}
        onClick={() => onRemove(tag.id)}
      >
        <X aria-hidden="true" />
      </Button>
    </span>
  );
}

export function ProjectTagFilter(props: ProjectTagFilterProps) {
  const { tags, className } = props;
  const { t } = useTranslation("projects");

  if (tags.length === 0)
    return null;

  const selected = props.multiple
    ? tags.filter(tag => props.selectedTagIds.includes(tag.id))
    : tags.filter(tag => props.selectedTagId === tag.id);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {props.multiple
        ? (
            <TagFilterCombobox
              tags={tags}
              selectedTagIds={props.selectedTagIds}
              onToggle={props.onToggle}
              active={selected.length > 0}
            />
          )
        : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={(
                  <Button
                    variant={selected.length > 0 ? "default" : "outline"}
                    className="shrink-0 rounded-md px-2.5 text-xs"
                    aria-label={t("list.tagFilterMoreLabel")}
                  />
                )}
              >
                {t("list.tagFilterMore")}
                <ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {tags.map(tag => (
                  <DropdownMenuItem
                    key={tag.id}
                    className={cn(props.selectedTagId === tag.id && "font-medium text-foreground")}
                    onClick={() => props.onSelect(tag.id)}
                  >
                    {tag.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

      {/* Selected tags as chips. Multi-select chips are removable; single-select
          `onSelect` is set-only (not a toggle — see index.lazy.tsx), so its one
          selected tag is shown as a non-removable highlighted label. */}
      {props.multiple
        ? selected.map(tag => (
            <RemovableChip key={tag.id} tag={tag} onRemove={props.onToggle} />
          ))
        : selected.map(tag => (
            <span
              key={tag.id}
              className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
            >
              {tag.name}
            </span>
          ))}
    </div>
  );
}

interface TagFilterComboboxProps {
  readonly tags: readonly ProjectTag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
  readonly active: boolean;
}

// Searchable, checked-state multi-select selector over the full tag list. Diffs
// the combobox value array against the controlled selection to emit a single
// `onToggle` per change.
function TagFilterCombobox({ tags, selectedTagIds, onToggle, active }: TagFilterComboboxProps) {
  const { t } = useTranslation("projects");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = q ? tags.filter(tag => tag.name.toLowerCase().includes(q)) : tags;

  const handleChange = (next: readonly string[]) => {
    const nextSet = new Set(next);
    const currentSet = new Set(selectedTagIds);
    for (const id of next) {
      if (!currentSet.has(id))
        onToggle(id);
    }
    for (const id of selectedTagIds) {
      if (!nextSet.has(id))
        onToggle(id);
    }
  };

  return (
    <Combobox
      multiple
      value={selectedTagIds as string[]}
      onValueChange={handleChange}
      onInputValueChange={setQuery}
    >
      <ComboboxTrigger
        aria-label={t("list.tagFilterMoreLabel")}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors",
          active
            ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
            : "border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {t("list.tagFilterMore")}
      </ComboboxTrigger>
      <ComboboxContent align="start">
        <ComboboxInput showTrigger={false} placeholder={t("list.tagFilterSearchPlaceholder")} />
        <ComboboxList>
          {matches.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("tags.empty")}</p>
          )}
          {matches.map(tag => (
            <ComboboxItem key={tag.id} value={tag.id}>{tag.name}</ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
