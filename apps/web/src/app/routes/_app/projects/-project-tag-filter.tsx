// Responsive tag filter, shared by the projects list (single-select) and the
// project issues tab (multi-select). Renders as many of the most-used tag chips
// as fit the available width inline, then tucks the rest behind a "More"
// control. The visible count is measured from a hidden layout layer and
// recomputed on container resize via ResizeObserver.
//
// Single-select overflow is a plain dropdown; multi-select overflow is a
// searchable combobox that shows the checked state per tag.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
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
import { computeVisibleTagCount } from "./-project-tag-filter-logic";

// Matches the row's `gap-2` (0.5rem) so the fit math lines up with layout.
const CHIP_GAP = 8;

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

interface TagChipProps {
  readonly tag: ProjectTag;
  readonly active: boolean;
  readonly onActivate: (tagId: string) => void;
  readonly tabIndex?: number;
}

function TagChip({ tag, active, onActivate, tabIndex }: TagChipProps) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-8 shrink-0 rounded-full"
      aria-pressed={active}
      tabIndex={tabIndex}
      onClick={() => onActivate(tag.id)}
    >
      {tag.name}
    </Button>
  );
}

export function ProjectTagFilter(props: ProjectTagFilterProps) {
  const { tags, className } = props;
  const { t } = useTranslation("projects");
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  // Normalise both modes to an `isActive` predicate and an `activate` toggle.
  const isActive = (tagId: string): boolean =>
    props.multiple ? props.selectedTagIds.includes(tagId) : props.selectedTagId === tagId;
  const activate = (tagId: string): void => {
    if (props.multiple)
      props.onToggle(tagId);
    else
      props.onSelect(tagId);
  };

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure)
      return;

    const recompute = () => {
      const widths = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-measure-chip]"),
      ).map(el => el.offsetWidth);
      const moreWidth = measure.querySelector<HTMLElement>("[data-measure-more]")?.offsetWidth ?? 0;
      const next = computeVisibleTagCount({
        widths,
        available: container.clientWidth,
        moreWidth,
        gap: CHIP_GAP,
      });
      // eslint-disable-next-line react/set-state-in-effect -- measured layout; only re-renders when the fit actually changes.
      setVisibleCount(prev => (prev === next ? prev : next));
    };

    recompute();
    if (typeof ResizeObserver === "undefined")
      return;
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tags]);

  if (tags.length === 0)
    return null;

  const count = Math.max(0, Math.min(visibleCount, tags.length));
  const inline = tags.slice(0, count);
  const overflow = tags.slice(count);
  const overflowActive = overflow.some(tag => isActive(tag.id));

  return (
    <div ref={containerRef} className={cn("relative flex min-w-0 items-center gap-2 overflow-hidden", className)}>
      {inline.map(tag => (
        <TagChip key={tag.id} tag={tag} active={isActive(tag.id)} onActivate={activate} />
      ))}

      {overflow.length > 0 && (
        props.multiple
          ? (
              <TagFilterMoreCombobox
                tags={tags}
                overflow={overflow}
                selectedTagIds={props.selectedTagIds}
                onToggle={props.onToggle}
                active={overflowActive}
              />
            )
          : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={(
                    <Button
                      size="sm"
                      variant={overflowActive ? "default" : "outline"}
                      className="h-8 shrink-0 rounded-full"
                      aria-label={t("list.tagFilterMoreLabel")}
                    />
                  )}
                >
                  {t("list.tagFilterMore")}
                  <ChevronDown aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflow.map(tag => (
                    <DropdownMenuItem
                      key={tag.id}
                      className={cn(isActive(tag.id) && "font-medium text-foreground")}
                      onClick={() => activate(tag.id)}
                    >
                      {tag.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
      )}

      {/* Hidden measuring layer: every chip plus the overflow trigger at their
          natural width, taken out of flow so it never affects the visible row. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 -z-10 flex items-center gap-2"
      >
        {tags.map(tag => (
          <span key={tag.id} data-measure-chip className="inline-flex">
            <TagChip tag={tag} active={false} onActivate={() => {}} tabIndex={-1} />
          </span>
        ))}
        <span data-measure-more className="inline-flex">
          <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full" tabIndex={-1}>
            {t("list.tagFilterMore")}
            <ChevronDown aria-hidden="true" />
          </Button>
        </span>
      </div>
    </div>
  );
}

interface TagFilterMoreComboboxProps {
  // Full vocabulary so the search box can reach inline tags too.
  readonly tags: readonly ProjectTag[];
  readonly overflow: readonly ProjectTag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
  readonly active: boolean;
}

// Searchable, checked-state multi-select popup for the overflow ("More") tags.
// Diffs the combobox value array against the controlled selection to emit a
// single `onToggle` per change.
function TagFilterMoreCombobox({ tags, overflow, selectedTagIds, onToggle, active }: TagFilterMoreComboboxProps) {
  const { t } = useTranslation("projects");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (q ? tags.filter(tag => tag.name.toLowerCase().includes(q)) : overflow);

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
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors",
          active
            ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
            : "border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {t("list.tagFilterMore")}
      </ComboboxTrigger>
      <ComboboxContent align="end">
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
