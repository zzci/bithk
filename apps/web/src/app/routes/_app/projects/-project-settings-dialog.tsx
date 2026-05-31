// Project settings dialog: a left-nav surface with distinct General, Members,
// Roles, and Categories sections. Each nav item is gated by the matching
// capability so a member only sees what they may manage. The dialog has a fixed
// size — the right pane scrolls internally so switching sections never resizes
// (or "jumps") the modal.

import type { KeyboardEvent } from "react";
import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { AlertTriangle, Copy, FolderTree, Settings, ShieldCheck, Users } from "lucide-react";
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
import { ProjectSettingsCategories } from "./-project-settings-categories";
import { ProjectSettingsDanger } from "./-project-settings-danger";
import { ProjectSettingsGeneral } from "./-project-settings-general";
import { ProjectSettingsMembers } from "./-project-settings-members";
import { ProjectSettingsRoles } from "./-project-settings-roles";

type SettingsSection = "general" | "members" | "roles" | "categories" | "danger";

const SECTION_ICON: Record<SettingsSection, typeof Settings> = {
  general: Settings,
  members: Users,
  roles: ShieldCheck,
  categories: FolderTree,
  danger: AlertTriangle,
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
  const { t } = useTranslation(["projects", "common"]);

  const sections = useMemo<readonly SettingsSection[]>(() => [
    caps.canManageProject ? "general" : null,
    caps.canManageMembers ? "members" : null,
    caps.canManageRoles ? "roles" : null,
    caps.canManageCategories ? "categories" : null,
    caps.canManageProject ? "danger" : null,
  ].filter((value): value is SettingsSection => value !== null), [caps]);

  const [active, setActive] = useState<SettingsSection>(sections[0] ?? "general");

  /* eslint-disable react/set-state-in-effect -- keep the active section valid
     when the available sections change (different caps / reopened dialog). */
  useEffect(() => {
    if (!sections.includes(active))
      setActive(sections[0] ?? "general");
  }, [sections, active]);
  /* eslint-enable react/set-state-in-effect */

  const label = (section: SettingsSection) => t(`settings.tabs.${section}` as const);

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
              {sections.map((section) => {
                const Icon = SECTION_ICON[section];
                const selected = active === section;
                return (
                  <button
                    key={section}
                    ref={(el) => {
                      if (el)
                        tabsRef.current.set(section, el);
                      else
                        tabsRef.current.delete(section);
                    }}
                    type="button"
                    role="tab"
                    id={tabId(section)}
                    aria-controls={panelId}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(section)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label(section)}
                  </button>
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
                <ProjectSettingsRoles projectId={project.id} canManage={caps.canManageRoles} />
              )}

              {active === "categories" && (
                <ProjectSettingsCategories projectId={project.id} canManage={caps.canManageCategories} />
              )}

              {active === "danger" && <ProjectSettingsDanger project={project} />}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
