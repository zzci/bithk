import type { DriveEntryStatus } from "@/shared/lib/api/drive";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

/** Client-side type facet applied on top of the fetched entry list. */
export type DriveTypeFilter = "all" | "folders" | "files";

interface FileFilterBarProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly typeFilter: DriveTypeFilter;
  readonly onTypeFilterChange: (value: DriveTypeFilter) => void;
  readonly status: DriveEntryStatus;
  readonly onStatusChange: (value: DriveEntryStatus) => void;
}

const TYPE_FILTERS: readonly DriveTypeFilter[] = ["all", "folders", "files"];

export function FileFilterBar({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  status,
  onStatusChange,
}: FileFilterBarProps) {
  const { t } = useTranslation("drive");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-48">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={event => onSearchChange(event.currentTarget.value)}
          placeholder={t("browser.searchPlaceholder")}
          aria-label={t("browser.searchPlaceholder")}
          className="pl-8"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label={t("browser.filter.type")}>
        {TYPE_FILTERS.map(value => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={typeFilter === value ? "default" : "outline"}
            aria-pressed={typeFilter === value}
            onClick={() => onTypeFilterChange(value)}
          >
            {t(`browser.filter.${value}`)}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label={t("browser.status.label")}>
        <Button
          type="button"
          size="sm"
          variant={status === "normal" ? "default" : "outline"}
          aria-pressed={status === "normal"}
          onClick={() => onStatusChange("normal")}
        >
          {t("browser.status.files")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === "trash" ? "default" : "outline"}
          aria-pressed={status === "trash"}
          onClick={() => onStatusChange("trash")}
        >
          {t("browser.status.trash")}
        </Button>
      </div>
    </div>
  );
}
