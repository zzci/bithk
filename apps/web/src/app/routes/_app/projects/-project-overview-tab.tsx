// Overview tab: description, status, creator, member count, and the project tags.

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
          <dt className="text-sm text-muted-foreground">{t("field.code")}</dt>
          <dd className="text-sm">{project.code || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</dd>
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

      <section className="space-y-1.5">
        <h2 className="text-sm font-medium text-muted-foreground">{t("field.tags")}</h2>
        {project.tags.length === 0
          ? <p className="text-sm text-muted-foreground">{t("overview.noTags")}</p>
          : (
              <div className="flex flex-wrap gap-1.5">
                {project.tags.map(tag => (
                  <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                ))}
              </div>
            )}
      </section>
    </div>
  );
}
