// Project settings dialog: a left-nav surface that groups General, Members &
// Roles, and Procurement Categories. Each nav item is gated by the matching
// capability so a member only sees what they may manage. The dialog has a fixed
// size — the right pane scrolls internally so switching sections never resizes
// (or "jumps") the modal.

import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { FolderTree, Settings, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { ProjectSettingsCategories } from "./-project-settings-categories";
import { ProjectSettingsGeneral } from "./-project-settings-general";
import { ProjectSettingsMembers } from "./-project-settings-members";
import { ProjectSettingsRoles } from "./-project-settings-roles";

type SettingsSection = "general" | "members" | "categories";

const SECTION_ICON: Record<SettingsSection, typeof Settings> = {
  general: Settings,
  members: Users,
  categories: FolderTree,
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
    caps.canManageMembers || caps.canManageRoles ? "members" : null,
    caps.canManageCategories ? "categories" : null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(34rem,90svh)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid h-full grid-cols-[13rem_1fr]">
          <aside className="flex min-h-0 flex-col border-r bg-muted/30 p-3">
            <DialogTitle className="px-2 pt-1 pb-3 text-sm font-semibold">{t("settings.title")}</DialogTitle>
            <nav role="tablist" aria-orientation="vertical" className="flex flex-col gap-1">
              {sections.map((section) => {
                const Icon = SECTION_ICON[section];
                const selected = active === section;
                return (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActive(section)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
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
          </aside>

          <section role="tabpanel" className="flex h-full min-h-0 flex-col">
            <header className="flex h-12 shrink-0 items-center border-b px-5">
              <h2 className="text-sm font-semibold">{label(active)}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {active === "general" && <ProjectSettingsGeneral project={project} />}

              {active === "members" && (
                <div className="space-y-6">
                  {caps.canManageMembers && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-medium">{t("settings.tabs.members")}</h3>
                      <ProjectSettingsMembers
                        projectId={project.id}
                        members={members}
                        userNames={userNames}
                        canManage={caps.canManageMembers}
                      />
                    </section>
                  )}
                  {caps.canManageRoles && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-medium">{t("settings.rolesHeading")}</h3>
                      <ProjectSettingsRoles projectId={project.id} canManage={caps.canManageRoles} />
                    </section>
                  )}
                </div>
              )}

              {active === "categories" && (
                <ProjectSettingsCategories projectId={project.id} canManage={caps.canManageCategories} />
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
