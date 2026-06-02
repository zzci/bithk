// Single-select tag filter for the ship list. Ship-local mirror of the project
// tag filter: a neutral dropdown lists the unselected tags, and the selected
// tag renders to its right as a removable chip whose X clears the selection.

import type { ShipTag } from "@/shared/lib/api/ships";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

interface ShipTagFilterProps {
  // Tags in most-used-first order (as returned by the API).
  readonly tags: readonly ShipTag[];
  readonly selectedTagId: string | null;
  readonly onSelect: (tagId: string) => void;
  readonly onClear: () => void;
  readonly className?: string;
}

export function ShipTagFilter({ tags, selectedTagId, onSelect, onClear, className }: ShipTagFilterProps) {
  const { t } = useTranslation("ships");

  if (tags.length === 0)
    return null;

  const selected = tags.filter(tag => tag.id === selectedTagId);
  const options = tags.filter(tag => tag.id !== selectedTagId);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              variant="outline"
              className="h-8 shrink-0 rounded-full px-2.5 text-xs"
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

      {selected.map(tag => (
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
            onClick={onClear}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
    </div>
  );
}
