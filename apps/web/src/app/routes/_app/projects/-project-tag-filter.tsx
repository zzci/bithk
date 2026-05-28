// Responsive tag filter for the projects list. Renders as many of the
// most-used tag chips as fit the available width inline, then tucks the rest
// into a "More" dropdown. The visible count is measured from a hidden layout
// layer and recomputed on container resize via ResizeObserver.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
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

interface ProjectTagFilterProps {
  // Tags in most-used-first order (as returned by the API).
  readonly tags: readonly ProjectTag[];
  readonly selectedTagId: string | null;
  readonly onSelect: (tagId: string) => void;
  readonly className?: string;
}

interface TagChipProps {
  readonly tag: ProjectTag;
  readonly active: boolean;
  readonly onSelect: (tagId: string) => void;
  readonly tabIndex?: number;
}

function TagChip({ tag, active, onSelect, tabIndex }: TagChipProps) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-8 shrink-0 rounded-full"
      aria-pressed={active}
      tabIndex={tabIndex}
      onClick={() => onSelect(tag.id)}
    >
      {tag.name}
    </Button>
  );
}

export function ProjectTagFilter({ tags, selectedTagId, onSelect, className }: ProjectTagFilterProps) {
  const { t } = useTranslation("projects");
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

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
  const overflowActive = overflow.some(tag => tag.id === selectedTagId);

  return (
    <div ref={containerRef} className={cn("relative flex min-w-0 items-center gap-2 overflow-hidden", className)}>
      {inline.map(tag => (
        <TagChip key={tag.id} tag={tag} active={selectedTagId === tag.id} onSelect={onSelect} />
      ))}

      {overflow.length > 0 && (
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
                className={cn(tag.id === selectedTagId && "font-medium text-foreground")}
                onClick={() => onSelect(tag.id)}
              >
                {tag.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
            <TagChip tag={tag} active={false} onSelect={() => {}} tabIndex={-1} />
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
