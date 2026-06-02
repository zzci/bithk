// Tag filter shared by the projects list (single-select) and the project
// issues / procurement tabs (multi-select). Hybrid layout: the top-N most-used
// tags are pinned as inline toggle chips, a "Tags" selector lists the rest, and
// non-pinned selected tags trail to the right as removable chips.
//
// Single-select uses a DropdownMenu; multi-select uses a searchable Combobox
// that shows the checked state per tag and diffs its value array down to a
// single `onToggle` per change. Both selectors are fed only the non-pinned
// remainder; the selector is hidden entirely when no remainder exists.

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
  // When provided, the selected tag renders as a removable chip whose X clears
  // the selection. Omit it to keep the chip non-removable (other consumers).
  readonly onClear?: () => void;
}

interface MultiSelectProps extends BaseProps {
  readonly multiple: true;
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
}

type ProjectTagFilterProps = SingleSelectProps | MultiSelectProps;

// Number of most-used tags pinned as inline toggle chips before the selector.
const PINNED_COUNT = 5;

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

  const pinned = tags.slice(0, PINNED_COUNT);
  const rest = tags.slice(PINNED_COUNT);

  const isActive = (tag: ProjectTag) =>
    props.multiple ? props.selectedTagIds.includes(tag.id) : props.selectedTagId === tag.id;

  // Selected tags that are NOT pinned trail as removable chips; pinned selected
  // tags convey their state through the pinned chip itself.
  const restSelected = props.multiple
    ? rest.filter(tag => props.selectedTagIds.includes(tag.id))
    : rest.filter(tag => props.selectedTagId === tag.id);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {/* Pinned inline toggle chips for the most-used tags. No X — toggles only. */}
      {pinned.map((tag) => {
        const active = isActive(tag);
        return (
          <Button
            key={tag.id}
            variant="outline"
            aria-pressed={active}
            aria-label={t("list.tagFilterPinLabel", { name: tag.name })}
            className={cn(
              "h-8 shrink-0 rounded-md px-2.5 text-xs font-medium",
              active
              && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
            )}
            onClick={() => {
              if (props.multiple)
                props.onToggle(tag.id);
              else if (active)
                props.onClear?.();
              else
                props.onSelect(tag.id);
            }}
          >
            {tag.name}
          </Button>
        );
      })}

      {/* Selector over the non-pinned remainder; hidden when nothing remains. */}
      {rest.length > 0 && (
        props.multiple
          ? (
              <TagFilterCombobox
                tags={rest}
                selectedTagIds={props.selectedTagIds}
                onToggle={props.onToggle}
              />
            )
          : (
              <SingleSelectDropdown
                tags={rest}
                selectedTagId={props.selectedTagId}
                onSelect={props.onSelect}
              />
            )
      )}

      {/* Non-pinned selected tags as chips. Multi-select chips are removable.
          Single-select shows its selected tag as a highlighted chip; with
          `onClear` it gets an X that clears the selection, otherwise a label. */}
      {props.multiple
        ? restSelected.map(tag => (
            <RemovableChip key={tag.id} tag={tag} onRemove={props.onToggle} />
          ))
        : restSelected.map(tag => (
            props.onClear
              ? (
                  <span
                    key={tag.id}
                    className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md bg-primary py-1 pr-1 pl-2.5 text-xs font-medium text-primary-foreground"
                  >
                    {tag.name}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("tags.remove", { name: tag.name })}
                      className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                      onClick={props.onClear}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </span>
                )
              : (
                  <span
                    key={tag.id}
                    className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
                  >
                    {tag.name}
                  </span>
                )
          ))}
    </div>
  );
}

interface SingleSelectDropdownProps {
  readonly tags: readonly ProjectTag[];
  readonly selectedTagId: string | null;
  readonly onSelect: (tagId: string) => void;
}

// Single-select dropdown over the unselected tags. The trigger stays neutral
// (outline) regardless of selection; the selected tag is conveyed by its chip.
function SingleSelectDropdown({ tags, selectedTagId, onSelect }: SingleSelectDropdownProps) {
  const { t } = useTranslation("projects");
  const options = tags.filter(tag => tag.id !== selectedTagId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            className="shrink-0 rounded-md px-2.5 text-xs"
            aria-label={t("list.tagFilterMoreLabel")}
          />
        )}
      >
        {t("list.tagFilterMore")}
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.length === 0
          ? (
              <DropdownMenuItem disabled className="text-muted-foreground">
                {t("list.tagFilterNoMore")}
              </DropdownMenuItem>
            )
          : options.map(tag => (
              <DropdownMenuItem key={tag.id} onClick={() => onSelect(tag.id)}>
                {tag.name}
              </DropdownMenuItem>
            ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TagFilterComboboxProps {
  readonly tags: readonly ProjectTag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
}

// Searchable, checked-state multi-select selector over the unselected tags. Diffs
// the combobox value array against the controlled selection to emit a single
// `onToggle` per change.
function TagFilterCombobox({ tags, selectedTagIds, onToggle }: TagFilterComboboxProps) {
  const { t } = useTranslation("projects");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const unselected = tags.filter(tag => !selectedTagIds.includes(tag.id));
  const matches = q ? unselected.filter(tag => tag.name.toLowerCase().includes(q)) : unselected;

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
          "border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {t("list.tagFilterMore")}
      </ComboboxTrigger>
      <ComboboxContent align="start">
        <ComboboxInput showTrigger={false} placeholder={t("list.tagFilterSearchPlaceholder")} />
        <ComboboxList>
          {matches.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("list.tagFilterNoMore")}</p>
          )}
          {matches.map(tag => (
            <ComboboxItem key={tag.id} value={tag.id}>{tag.name}</ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
