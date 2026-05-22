// Flat view-nav sidebar for the drive page, styled to match the documents
// page sidebar. Switches the main pane between the drive's primary views.

import {
  Clock,
  HardDrive,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

export type DriveView
  = | "my-files"
    | "recent"
    | "favorites"
    | "trash"
    | "shared-with-me"
    | "shared-by-me"
    | "team-directories";

interface NavItem {
  readonly view: DriveView;
  readonly icon: typeof HardDrive;
  readonly labelKey: string;
}

interface NavSection {
  readonly labelKey: string;
  readonly items: readonly NavItem[];
}

const SECTIONS: readonly NavSection[] = [
  {
    labelKey: "sidebar.section.files",
    items: [
      { view: "my-files", icon: HardDrive, labelKey: "sidebar.myFiles" },
      { view: "recent", icon: Clock, labelKey: "sidebar.recent" },
      { view: "favorites", icon: Star, labelKey: "sidebar.favorites" },
      { view: "trash", icon: Trash2, labelKey: "sidebar.trash" },
    ],
  },
  {
    labelKey: "sidebar.section.shared",
    items: [
      { view: "shared-with-me", icon: Share2, labelKey: "sidebar.sharedWithMe" },
      { view: "shared-by-me", icon: Upload, labelKey: "sidebar.sharedByMe" },
    ],
  },
  {
    labelKey: "sidebar.section.team",
    items: [
      { view: "team-directories", icon: Users, labelKey: "sidebar.teamDirectories" },
    ],
  },
];

export function DriveSidebar({
  activeView,
  onSelect,
}: {
  readonly activeView: DriveView;
  readonly onSelect: (view: DriveView) => void;
}) {
  const { t } = useTranslation("drive");

  // Outer chrome (width / bg-muted / border-r) is owned by the page wrapper
  // so the same content works in both the inline desktop column and the
  // mobile slide-in Sheet.
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="flex h-[45px] shrink-0 items-center gap-1 border-b border-border px-4">
        <h2 className="flex-1 truncate text-base font-semibold tracking-tight">
          {t("page.title")}
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" aria-label={t("page.title")}>
        {SECTIONS.map(section => (
          <div key={section.labelKey} className="mb-2">
            <div className="px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t(section.labelKey)}
            </div>
            <ul>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.view;
                return (
                  <li key={item.view}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.view)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors",
                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/40",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
