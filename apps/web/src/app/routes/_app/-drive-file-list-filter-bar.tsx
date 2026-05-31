import type { ReactNode } from "react";
import type { DriveFilterBarProps } from "./-drive-file-list-types";
// Filter bar (type / owner / modified / source) for the drive file-list surface.
import type {
  DriveModifiedFilter,
  DriveOwnerFilter,
  DriveSourceFilter,
  DriveTypeFilter,
} from "./-file-browser-types";
import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { FILE_ICONS } from "./-file-browser-types";

export function DriveFilterBar({
  typeFilter,
  ownerFilter,
  modifiedFilter,
  sourceFilter,
  onTypeFilterChange,
  onOwnerFilterChange,
  onModifiedFilterChange,
  onSourceFilterChange,
  extraFilters,
}: DriveFilterBarProps) {
  const { t } = useTranslation("drive");

  const typeFilterLabels: Record<DriveTypeFilter, string> = {
    all: t("browser.filter.all"),
    folders: t("browser.filter.folders"),
    files: t("browser.filter.files"),
    pdf: "PDF",
    image: t("browser.filter.images"),
    document: t("browser.filter.documents"),
    spreadsheet: t("browser.filter.spreadsheets"),
  };

  const typeFilterIcons: Record<DriveTypeFilter, ReactNode> = {
    all: null,
    folders: FILE_ICONS.folder("size-4"),
    files: FILE_ICONS.file("size-4"),
    pdf: FILE_ICONS.pdf("size-4"),
    image: FILE_ICONS.image("size-4"),
    document: FILE_ICONS.document("size-4"),
    spreadsheet: FILE_ICONS.spreadsheet("size-4"),
  };

  const ownerFilterLabels: Record<DriveOwnerFilter, string> = {
    all: t("browser.filter.all"),
    me: t("browser.filter.ownedByMe"),
  };

  const modifiedFilterLabels: Record<DriveModifiedFilter, string> = {
    "all": t("browser.filter.all"),
    "today": t("browser.filter.modifiedToday"),
    "7d": t("browser.filter.modified7Days"),
    "30d": t("browser.filter.modified30Days"),
  };

  const sourceFilterLabels: Record<DriveSourceFilter, string> = {
    all: t("browser.filter.all"),
    current: t("browser.filter.currentSource"),
  };

  const filterMenu = <T extends string>(
    label: string,
    value: T,
    options: { value: T; label: string; icon?: ReactNode }[],
    onChange: (value: T) => void,
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            className={cn(
              "shrink-0 whitespace-nowrap",
              value !== "all" && "bg-accent",
            )}
          />
        )}
      >
        <span>{label}</span>
        {value !== "all" && (
          <span className="text-muted-foreground">
            {options.find(option => option.value === value)?.label}
          </span>
        )}
        {value !== "all" && options.find(option => option.value === value)?.icon}
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {options.map(option => (
            <DropdownMenuItem key={option.value} className="gap-3" onClick={() => onChange(option.value)}>
              {options.some(item => item.icon) && (
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {option.icon}
                </span>
              )}
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex shrink-0 items-center gap-2">
      {filterMenu(
        t("browser.filter.typeLabel"),
        typeFilter,
        (Object.keys(typeFilterLabels) as DriveTypeFilter[]).map(value => ({
          value,
          label: typeFilterLabels[value],
          icon: typeFilterIcons[value],
        })),
        onTypeFilterChange,
      )}
      {filterMenu(
        t("browser.filter.people"),
        ownerFilter,
        (Object.keys(ownerFilterLabels) as DriveOwnerFilter[]).map(value => ({ value, label: ownerFilterLabels[value] })),
        onOwnerFilterChange,
      )}
      {filterMenu(
        t("browser.filter.modified"),
        modifiedFilter,
        (Object.keys(modifiedFilterLabels) as DriveModifiedFilter[]).map(value => ({ value, label: modifiedFilterLabels[value] })),
        onModifiedFilterChange,
      )}
      {filterMenu(
        t("browser.filter.source"),
        sourceFilter,
        (Object.keys(sourceFilterLabels) as DriveSourceFilter[]).map(value => ({ value, label: sourceFilterLabels[value] })),
        onSourceFilterChange,
      )}
      {(extraFilters ?? []).map(filter => (
        <Fragment key={filter.label}>
          {filterMenu(filter.label, filter.value, [...filter.options], filter.onChange)}
        </Fragment>
      ))}
    </div>
  );
}
