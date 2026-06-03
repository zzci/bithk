import type { ReactNode } from "react";
import type { DriveFilterBarProps } from "./-drive-file-list-types";
// Filter bar (type / owner / modified / source [+ extra]) for the drive
// file-list surface. Thin adapter that maps the drive string-union filters onto
// the shared, Drive-style `ListFilter` (one independent dropdown per dimension).
import type {
  DriveModifiedFilter,
  DriveOwnerFilter,
  DriveSourceFilter,
  DriveTypeFilter,
} from "./-file-browser-types";
import type { FilterDimension } from "@/shared/components/list-filter";
import { useTranslation } from "react-i18next";

import { ListFilter } from "@/shared/components/list-filter";
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

  const typeOptions: { value: DriveTypeFilter; label: string; icon?: ReactNode }[] = [
    { value: "all", label: t("browser.filter.all") },
    { value: "folders", label: t("browser.filter.folders"), icon: FILE_ICONS.folder("size-4") },
    { value: "files", label: t("browser.filter.files"), icon: FILE_ICONS.file("size-4") },
    { value: "pdf", label: "PDF", icon: FILE_ICONS.pdf("size-4") },
    { value: "image", label: t("browser.filter.images"), icon: FILE_ICONS.image("size-4") },
    { value: "document", label: t("browser.filter.documents"), icon: FILE_ICONS.document("size-4") },
    { value: "spreadsheet", label: t("browser.filter.spreadsheets"), icon: FILE_ICONS.spreadsheet("size-4") },
  ];

  const dimensions: FilterDimension[] = [
    {
      key: "type",
      label: t("browser.filter.typeLabel"),
      mode: "single",
      defaultValue: "all",
      value: typeFilter,
      onChange: value => onTypeFilterChange((value ?? "all") as DriveTypeFilter),
      options: typeOptions,
    },
    {
      key: "owner",
      label: t("browser.filter.people"),
      mode: "single",
      defaultValue: "all",
      value: ownerFilter,
      onChange: value => onOwnerFilterChange((value ?? "all") as DriveOwnerFilter),
      options: [
        { value: "all", label: t("browser.filter.all") },
        { value: "me", label: t("browser.filter.ownedByMe") },
      ],
    },
    {
      key: "modified",
      label: t("browser.filter.modified"),
      mode: "single",
      defaultValue: "all",
      value: modifiedFilter,
      onChange: value => onModifiedFilterChange((value ?? "all") as DriveModifiedFilter),
      options: [
        { value: "all", label: t("browser.filter.all") },
        { value: "today", label: t("browser.filter.modifiedToday") },
        { value: "7d", label: t("browser.filter.modified7Days") },
        { value: "30d", label: t("browser.filter.modified30Days") },
      ],
    },
    {
      key: "source",
      label: t("browser.filter.source"),
      mode: "single",
      defaultValue: "all",
      value: sourceFilter,
      onChange: value => onSourceFilterChange((value ?? "all") as DriveSourceFilter),
      options: [
        { value: "all", label: t("browser.filter.all") },
        { value: "current", label: t("browser.filter.currentSource") },
      ],
    },
    ...(extraFilters ?? []).map((filter): FilterDimension => ({
      key: filter.label,
      label: filter.label,
      mode: "single",
      defaultValue: "all",
      value: filter.value,
      onChange: value => filter.onChange(value ?? "all"),
      options: [...filter.options],
    })),
  ];

  return <ListFilter dimensions={dimensions} className="shrink-0" />;
}
