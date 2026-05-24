// Project settings dialog: a tabbed surface that groups General, Members &
// Roles, and Procurement Categories. Each tab is gated by the matching
// capability so a member only sees what they may manage.

import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { ProjectSettingsCategories } from "./-project-settings-categories";
import { ProjectSettingsGeneral } from "./-project-settings-general";
import { ProjectSettingsMembers } from "./-project-settings-members";
import { ProjectSettingsRoles } from "./-project-settings-roles";

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

  const tabs = useMemo(() => {
    const list: readonly string[] = [
      caps.canManageProject ? "general" : null,
      caps.canManageMembers || caps.canManageRoles ? "members" : null,
      caps.canManageCategories ? "categories" : null,
    ].filter((value): value is string => value !== null);
    return list;
  }, [caps]);

  const firstTab = tabs[0] ?? "general";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={firstTab}>
          <TabsList variant="line">
            {tabs.includes("general") && <TabsTrigger value="general">{t("settings.tabs.general")}</TabsTrigger>}
            {tabs.includes("members") && <TabsTrigger value="members">{t("settings.tabs.members")}</TabsTrigger>}
            {tabs.includes("categories") && <TabsTrigger value="categories">{t("settings.tabs.categories")}</TabsTrigger>}
          </TabsList>

          {tabs.includes("general") && (
            <TabsContent value="general" className="pt-4">
              <ProjectSettingsGeneral project={project} />
            </TabsContent>
          )}

          {tabs.includes("members") && (
            <TabsContent value="members" className="space-y-6 pt-4">
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
            </TabsContent>
          )}

          {tabs.includes("categories") && (
            <TabsContent value="categories" className="pt-4">
              <ProjectSettingsCategories projectId={project.id} canManage={caps.canManageCategories} />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
