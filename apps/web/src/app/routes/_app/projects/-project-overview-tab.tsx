// Overview tab: description, dates, status, creator, member count.

import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";

interface ProjectOverviewTabProps {
  readonly project: ProjectView;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
}

export function ProjectOverviewTab({ project, members, userNames }: ProjectOverviewTabProps) {
  const { t } = useTranslation("projects");

  const dateRange = project.startDate || project.endDate
    ? t("overview.dateRange", {
        start: project.startDate ?? t("overview.notSet"),
        end: project.endDate ?? t("overview.notSet"),
      })
    : t("overview.notSet");

  return (
    <div className="space-y-6">
      <section className="space-y-1.5">
        <h2 className="text-sm font-medium text-muted-foreground">{t("overview.description")}</h2>
        <p className="text-sm whitespace-pre-wrap">
          {project.description || <span className="text-muted-foreground">{t("overview.noDescription")}</span>}
        </p>
      </section>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-sm text-muted-foreground">{t("overview.status")}</dt>
          <dd>
            <Badge variant="outline" className="text-xs">{t(`status.${project.status}` as const)}</Badge>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm text-muted-foreground">{t("overview.dates")}</dt>
          <dd className="text-sm">{dateRange}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm text-muted-foreground">{t("overview.members")}</dt>
          <dd className="text-sm">{t("overview.memberCount", { count: members.length })}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm text-muted-foreground">{t("overview.creator")}</dt>
          <dd className="text-sm">{userNames.get(project.creatorId) ?? project.creatorId}</dd>
        </div>
      </dl>
    </div>
  );
}
