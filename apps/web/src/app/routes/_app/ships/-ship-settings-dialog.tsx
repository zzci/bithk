// Per-ship settings dialog: a left-nav surface mirroring the project settings
// dialog. It currently holds a single Equipment-categories section, but keeps
// the tablist + roving-tabindex shell so adding future sections is a one-line
// change (a `sections` entry + a render-switch branch). The dialog has a fixed
// size — the right pane scrolls internally so switching sections never resizes
// (or "jumps") the modal.

import type { KeyboardEvent } from "react";
import type { ShipView } from "@/shared/lib/api/ships";
import { FolderTree } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { ShipEquipmentCategoriesSection } from "./-ship-equipment-categories";

type SettingsSection = "categories";

const SECTION_ICON: Record<SettingsSection, typeof FolderTree> = {
  categories: FolderTree,
};

interface ShipSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly ship: ShipView;
  readonly canManage: boolean;
}

export function ShipSettingsDialog({ open, onOpenChange, ship, canManage }: ShipSettingsDialogProps) {
  const { t } = useTranslation(["ships", "common"]);

  // Single section today; the array + render switch below keep the surface
  // extensible — a new section is one entry here plus one render branch.
  const sections: readonly SettingsSection[] = ["categories"];
  const [active, setActive] = useState<SettingsSection>(sections[0] ?? "categories");

  const label = (section: SettingsSection): string => {
    switch (section) {
      case "categories":
        return t("equipmentCategories.title");
    }
  };

  // Stable ids tie each tab to the shared panel (aria-controls) and let the
  // panel point back to the active tab (aria-labelledby).
  const baseId = useId();
  const tabId = (section: SettingsSection) => `${baseId}-tab-${section}`;
  const panelId = `${baseId}-panel`;

  // Roving-tabindex focus targets keyed by section so Arrow/Home/End can move
  // focus to the newly activated tab.
  const tabsRef = useRef(new Map<SettingsSection, HTMLButtonElement>());

  const moveActive = (section: SettingsSection) => {
    setActive(section);
    tabsRef.current.get(section)?.focus();
  };

  // Vertical tablist: Up/Down cycle through tabs, Home/End jump to the edges.
  // Activation follows focus (only the active tab stays in the Tab sequence).
  const handleTablistKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const count = sections.length;
    if (count === 0)
      return;
    const current = Math.max(0, sections.indexOf(active));
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (current + 1) % count;
        break;
      case "ArrowUp":
        nextIndex = (current - 1 + count) % count;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = sections[nextIndex];
    if (next)
      moveActive(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(34rem,90svh)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid h-full min-h-0 grid-cols-[13rem_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-muted/30 p-3">
            <DialogTitle className="px-2 pt-1 pb-3 text-sm font-semibold">{t("settings.dialogTitle")}</DialogTitle>
            <nav
              role="tablist"
              aria-orientation="vertical"
              aria-label={t("settings.dialogTitle")}
              className="flex flex-col gap-1"
              onKeyDown={handleTablistKeyDown}
            >
              {sections.map((section) => {
                const Icon = SECTION_ICON[section];
                const selected = active === section;
                return (
                  <Button
                    key={section}
                    ref={(el) => {
                      if (el)
                        tabsRef.current.set(section, el);
                      else
                        tabsRef.current.delete(section);
                    }}
                    type="button"
                    variant="ghost"
                    role="tab"
                    id={tabId(section)}
                    aria-controls={panelId}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(section)}
                    className={cn(
                      "h-auto justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal transition-colors",
                      selected
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label(section)}
                  </Button>
                );
              })}
            </nav>
          </aside>

          <section
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(active)}
            tabIndex={0}
            className="flex h-full min-h-0 flex-col outline-none"
          >
            <header className="flex h-12 shrink-0 items-center border-b px-5">
              <h2 className="text-sm font-semibold">{label(active)}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {active === "categories" && (
                <ShipEquipmentCategoriesSection shipShortId={ship.id} canManage={canManage} />
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
