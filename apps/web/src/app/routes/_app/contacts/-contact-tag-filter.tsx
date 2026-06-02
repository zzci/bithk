// Contacts-local tag multi-select filter. Self-contained on purpose: the
// projects tag filter (-project-tag-filter.tsx) is owned by a concurrent
// campaign, so this component deliberately does not import it. A DropdownMenu of
// checkbox items toggles the union (OR) selection; the chosen tags trail as
// removable chips whose × clears just that tag.

import type { ProjectTag } from "@/shared/lib/api/projects";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

interface ContactTagFilterProps {
  // Selectable vocabulary in most-used-first order (as returned by the API).
  readonly tags: readonly ProjectTag[];
  readonly selectedTagIds: readonly string[];
  readonly onToggle: (tagId: string) => void;
}

export function ContactTagFilter({ tags, selectedTagIds, onToggle }: ContactTagFilterProps) {
  const { t } = useTranslation("contacts");
  const selected = new Set(selectedTagIds);
  const selectedTags = tags.filter(tag => selected.has(tag.id));
  const count = selectedTagIds.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" className="justify-between font-normal" />}>
          <span className="truncate">
            {count > 0 ? t("list.tagFilterLabelCount", { count }) : t("list.tagFilterLabel")}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          {tags.length === 0
            ? <DropdownMenuItem disabled>{t("list.tagFilterEmpty")}</DropdownMenuItem>
            : tags.map(tag => (
                <DropdownMenuCheckboxItem
                  key={tag.id}
                  checked={selected.has(tag.id)}
                  onCheckedChange={() => onToggle(tag.id)}
                >
                  <span className="truncate">{tag.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedTags.map(tag => (
        <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
          <span className="max-w-[8rem] truncate">{tag.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("list.tagFilterRemove", { name: tag.name })}
            onClick={() => onToggle(tag.id)}
            className="rounded-sm hover:text-destructive"
          >
            <X data-icon="inline" />
          </Button>
        </Badge>
      ))}
    </div>
  );
}
