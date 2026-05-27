// Overview tab: description, procurement category preview, and a member preview.
// Status/code/creator/tags live in the detail header and are not repeated here.

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

      {/* Member preview in the narrow column. */}
      <div className="space-y-4">
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
