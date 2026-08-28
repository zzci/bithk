// Project settings dialog: a left-nav surface with the CORE panels (General,
// Members, Roles, Sections, Danger zone) plus the panels each MOUNTED SECTION
// contributes through `-project-sections.ts` (procurement's categories,
// equipment's categories). Each nav item is gated by the matching capability so
// a member only sees what they may manage, and a section's panel disappears
// with the section itself. The dialog has a fixed size — the right pane scrolls
// internally so switching panels never resizes (or "jumps") the modal.

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { ProjectCapabilityInfo } from "@/shared/hooks/use-project-capabilities";
import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { AlertTriangle, Blocks, Copy, FolderTree, Settings, ShieldCheck, Users, Wrench } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { ProjectEquipmentCategoriesSection } from "./-project-equipment-categories";
import { mountableProjectSections } from "./-project-sections";
import { ProjectSettingsCategories } from "./-project-settings-categories";
import { ProjectSettingsDanger } from "./-project-settings-danger";
import { ProjectSettingsGeneral } from "./-project-settings-general";
import { ProjectSettingsMembers } from "./-project-settings-members";
import { ProjectSettingsRoles } from "./-project-settings-roles";
import { ProjectSettingsSections } from "./-project-settings-sections";

// Core panels, always keyed by a fixed id; a section-contributed panel is keyed
// by its section key instead ("procurement", "equipment", …).
type CoreSettingsPanel = "general" | "members" | "roles" | "sections" | "danger";
type SettingsPanel = string;

const PANEL_ICON: Record<string, LucideIcon> = {
  general: Settings,
  members: Users,
  roles: ShieldCheck,
  sections: Blocks,
  danger: AlertTriangle,
  procurement: FolderTree,
  equipment: Wrench,
};

interface ProjectSettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: ProjectView;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  readonly caps: ProjectCapabilityInfo;
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
  members,
  userNames,
  caps,
}: ProjectSettingsDialogProps) {
  // `ships` supplies the labels of the maritime sections' contributed panels;
  // the registry names the namespace per entry.
  const { t } = useTranslation(["projects", "ships", "common"]);

  // Section-contributed panels: one per MOUNTED section that declares a
  // `settingsPanel` and whose panel capability the caller holds. Gated on the
  // MOUNT plus the PANEL's capability, not the tab's view capability — managing
  // a section's vocabulary is a separate grant from reading its records.
  // Ordered by the registry so they follow the detail tabs' order.
  const contributed = useMemo(
    () => mountableProjectSections()
      .filter(entry => entry.settingsPanel !== undefined && project.sections.includes(entry.key))
      .filter(entry => !entry.settingsPanel!.capability || caps.has(entry.settingsPanel!.capability))
      .map(entry => ({ key: entry.key, label: `${entry.i18nNamespace}:${entry.settingsPanel!.labelKey}` })),
    [project.sections, caps],
  );

  const panels = useMemo<readonly SettingsPanel[]>(() => [
    caps.canManageProject ? "general" : null,
    caps.canManageMembers ? "members" : null,
    caps.canManageRoles ? "roles" : null,
    caps.canManageProject ? "sections" : null,
    ...contributed.map(entry => entry.key),
    caps.canManageProject ? "danger" : null,
  ].filter((value): value is SettingsPanel => value !== null), [caps, contributed]);

  const [active, setActive] = useState<SettingsPanel>(panels[0] ?? "general");

  /* eslint-disable react/set-state-in-effect -- keep the active panel valid
     when the available panels change (different caps / reopened dialog). */
  useEffect(() => {
    if (!panels.includes(active))
      setActive(panels[0] ?? "general");
  }, [panels, active]);
  /* eslint-enable react/set-state-in-effect */

  const label = (panel: SettingsPanel) => {
    const contribution = contributed.find(entry => entry.key === panel);
    return contribution ? t(contribution.label) : t(`settings.tabs.${panel as CoreSettingsPanel}` as const);
  };

  // Stable ids tie each tab to the shared panel (aria-controls) and let the
  // panel point back to the active tab (aria-labelledby).
  const baseId = useId();
  const tabId = (panel: SettingsPanel) => `${baseId}-tab-${panel}`;
  const panelId = `${baseId}-panel`;

  // Roving-tabindex focus targets keyed by panel so Arrow/Home/End can move
  // focus to the newly activated tab.
  const tabsRef = useRef(new Map<SettingsPanel, HTMLButtonElement>());

  const moveActive = (panel: SettingsPanel) => {
    setActive(panel);
    tabsRef.current.get(panel)?.focus();
  };

  // Vertical tablist: Up/Down cycle through tabs, Home/End jump to the edges.
  // Activation follows focus (only the active tab stays in the Tab sequence).
  const handleTablistKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const count = panels.length;
    if (count === 0)
      return;
    const current = Math.max(0, panels.indexOf(active));
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
    const next = panels[nextIndex];
    if (next)
      moveActive(next);
  };

  // Surface the canonical short id used in the project URL (no 'p-' prefix),
  // not the legacy display code. project.id always exists.
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(project.id);
      toast.success(t("detail.codeCopied"));
    }
    catch {
      toast.error(t("detail.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(34rem,90svh)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid h-full min-h-0 grid-cols-[13rem_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-muted/30 p-3">
            <DialogTitle className="px-2 pt-1 pb-3 text-sm font-semibold">{t("settings.title")}</DialogTitle>
            <nav
              role="tablist"
              aria-orientation="vertical"
              aria-label={t("settings.title")}
              className="flex flex-col gap-1"
              onKeyDown={handleTablistKeyDown}
            >
              {panels.map((panel) => {
                const Icon = PANEL_ICON[panel] ?? Settings;
                const selected = active === panel;
                return (
                  <Button
                    key={panel}
                    ref={(el) => {
                      if (el)
                        tabsRef.current.set(panel, el);
                      else
                        tabsRef.current.delete(panel);
                    }}
                    type="button"
                    variant="ghost"
                    role="tab"
                    id={tabId(panel)}
                    aria-controls={panelId}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(panel)}
                    className={cn(
                      "h-auto justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal transition-colors",
                      selected
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label(panel)}
                  </Button>
                );
              })}
            </nav>
            {project.id && (
              <Button
                type="button"
                variant="ghost"
                className="mt-auto justify-start gap-1.5 px-2 text-xs text-muted-foreground"
                aria-label={t("detail.copyCode")}
                onClick={() => void handleCopyCode()}
              >
                <span className="truncate">
                  {t("settings.projectId")}
                  <span className="font-mono">{project.id}</span>
                </span>
                <Copy aria-hidden="true" className="size-3 shrink-0" />
              </Button>
            )}
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
              {active === "general" && <ProjectSettingsGeneral project={project} />}

              {active === "members" && (
                <ProjectSettingsMembers
                  projectId={project.id}
                  members={members}
                  userNames={userNames}
                  canManage={caps.canManageMembers}
                />
              )}

              {active === "roles" && (
                <ProjectSettingsRoles projectId={project.id} sections={project.sections} canManage={caps.canManageRoles} />
              )}

              {active === "sections" && (
                <ProjectSettingsSections project={project} canManage={caps.canManageProject} />
              )}

              {/* Section-contributed panels: the registry decides WHETHER the
                  entry exists, this maps its key to the component that fills it. */}
              {active === "procurement" && (
                <ProjectSettingsCategories projectId={project.id} canManage={caps.canManageCategories} />
              )}

              {active === "equipment" && (
                <ProjectEquipmentCategoriesSection projectId={project.id} canManage={caps.canManageProject} />
              )}

              {active === "danger" && <ProjectSettingsDanger project={project} />}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
