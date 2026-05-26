// Overview tab: description and key information cards plus a member preview.

import type { ProjectMemberView, ProjectView } from "@/shared/lib/api/projects";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { useProcurementCategories } from "@/shared/lib/api/projects";
import { formatDate } from "@/shared/lib/format";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { memberLabel } from "./-member-helpers";

interface ProjectOverviewTabProps {
  readonly project: ProjectView;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
}

export function ProjectOverviewTab({ project, members, userNames }: ProjectOverviewTabProps) {
  const { t } = useTranslation("projects");
  const categoriesQuery = useProcurementCategories(project.id);
  const categories = categoriesQuery.data ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Description + tags span the wider column. */}
      <div className="space-y-4 lg:col-span-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("overview.description")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">
              {project.description || <span className="text-muted-foreground">{t("overview.noDescription")}</span>}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("field.tags")}</CardTitle>
          </CardHeader>
          <CardContent>
            {project.tags.length === 0
              ? <p className="text-sm text-muted-foreground">{t("overview.noTags")}</p>
              : (
                  <div className="flex flex-wrap gap-1.5">
                    {project.tags.map(tag => (
                      <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
                    ))}
                  </div>
                )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("overview.categoryPreview")}</CardTitle>
          </CardHeader>
          <CardContent>
            {categoriesQuery.isLoading
              ? <p className="text-sm text-muted-foreground">{t("overview.categoriesLoading")}</p>
              : categories.length === 0
                ? <p className="text-sm text-muted-foreground">{t("categories.empty")}</p>
                : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {categories.slice(0, 6).map(category => (
                        <div key={category.id} className="rounded-md border bg-muted/30 px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{category.name}</div>
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                {category.description || t("overview.noDescription")}
                              </p>
                            </div>
                            {category.code && (
                              <Badge variant="outline" className="shrink-0 text-xs">{category.code}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
          </CardContent>
        </Card>
      </div>

      {/* Key info + member preview in the narrow column. */}
      <div className="space-y-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("overview.keyInfo")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t("overview.status")}</dt>
                <dd>
                  <Badge variant="secondary" className={`text-xs ${RECORD_STATUS_BADGE[project.status]}`}>{t(`status.${project.status}` as const)}</Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t("field.code")}</dt>
                <dd className="text-sm">{project.code || <span className="text-muted-foreground">{t("overview.notSet")}</span>}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t("overview.members")}</dt>
                <dd className="text-sm">{t("overview.memberCount", { count: members.length })}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t("overview.creator")}</dt>
                <dd className="text-sm">{userNames.get(project.creatorId) ?? project.creatorId}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-sm text-muted-foreground">{t("overview.updatedAt")}</dt>
                <dd className="text-sm">{formatDate(project.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{t("overview.memberPreview")}</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length === 0
              ? <p className="text-sm text-muted-foreground">{t("overview.noMembers")}</p>
              : (
                  <ul className="space-y-1.5">
                    {members.slice(0, 6).map(m => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{memberLabel(m, userNames)}</span>
                        {m.title && <span className="shrink-0 text-xs text-muted-foreground">{m.title}</span>}
                      </li>
                    ))}
                  </ul>
                )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
