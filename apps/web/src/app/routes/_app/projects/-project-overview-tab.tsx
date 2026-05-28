// Overview tab: the project info block (moved from the old header), the project
// description, a mixed pinned-items area, and the latest work orders +
// procurements. Read-only — pinning happens on the rows in the Issues /
// Procurement tabs.

import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { PinnedItem } from "@/shared/lib/api/pins";
import type { ProjectView } from "@/shared/lib/api/projects";
import { ClipboardList, Package, Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { usePinnedItems } from "@/shared/lib/api/pins";
import { useProcurements } from "@/shared/lib/api/procurement";
import { useProjectIssues } from "@/shared/lib/api/projects";
import { formatDate } from "@/shared/lib/format";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";

export type ProjectTab = "issues" | "procurement";

interface ProjectOverviewTabProps {
  readonly project: ProjectView;
  readonly userNames: ReadonlyMap<string, string>;
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectTab) => void;
}

export function ProjectOverviewTab({ project, userNames, caps, onOpenTab }: ProjectOverviewTabProps) {
  const { t } = useTranslation("projects");

  const latestIssuesQuery = useProjectIssues(project.id, { limit: 5 });
  const latestProcurementsQuery = useProcurements(project.id, { limit: 5 }, caps.canViewProcurement);

  return (
    <div className="space-y-6">
      {/* 1. Info block (moved out of the old detail header). */}
      <Card>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {t("overview.creator")}
              {": "}
              {userNames.get(project.creatorId) ?? project.creatorId}
            </span>
            <span className="text-muted-foreground/40">/</span>
            <span>
              {t("overview.updatedAt")}
              {": "}
              {formatDate(project.updatedAt)}
            </span>
          </div>

          {project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Description — reuses project.description, no new field. */}
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

      {/* 3. Mixed pinned items (issues + procurements). */}
      <ProjectPinnedSection projectId={project.id} caps={caps} onOpenTab={onOpenTab} />

      {/* 4. Latest work orders. */}
      <Card size="sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm text-muted-foreground">{t("overview.latestIssues")}</CardTitle>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onOpenTab("issues")}>
            {t("overview.viewAll")}
          </Button>
        </CardHeader>
        <CardContent>
          {latestIssuesQuery.isLoading
            ? <p className="text-sm text-muted-foreground">{t("issues.loading")}</p>
            : (latestIssuesQuery.data?.data.length ?? 0) === 0
                ? <p className="text-sm text-muted-foreground">{t("issues.empty")}</p>
                : (
                    <ul className="divide-y rounded-md border">
                      {latestIssuesQuery.data!.data.map(issue => (
                        <li key={issue.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => onOpenTab("issues")}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                            <Badge variant="secondary" className={`shrink-0 text-xs ${ISSUE_STATUS_BADGE[issue.status]}`}>
                              {t(`issues.status.${issue.status}` as const)}
                            </Badge>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(issue.updatedAt)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
        </CardContent>
      </Card>

      {/* 5. Latest procurements — gated by procurement.view. */}
      {caps.canViewProcurement && (
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm text-muted-foreground">{t("overview.latestProcurements")}</CardTitle>
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onOpenTab("procurement")}>
              {t("overview.viewAll")}
            </Button>
          </CardHeader>
          <CardContent>
            {latestProcurementsQuery.isLoading
              ? <p className="text-sm text-muted-foreground">{t("procurement.loading")}</p>
              : (latestProcurementsQuery.data?.data.length ?? 0) === 0
                  ? <p className="text-sm text-muted-foreground">{t("procurement.empty")}</p>
                  : (
                      <ul className="divide-y rounded-md border">
                        {latestProcurementsQuery.data!.data.map(p => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => onOpenTab("procurement")}
                            >
                              <span className="min-w-0 flex-1 truncate text-sm">{p.itemName}</span>
                              <Badge variant="outline" className="shrink-0 text-xs">
                                {t(`procurement.status.${p.status}` as const)}
                              </Badge>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(p.updatedAt)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface ProjectPinnedSectionProps {
  readonly projectId: string;
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectTab) => void;
}

function ProjectPinnedSection({ projectId, caps, onOpenTab }: ProjectPinnedSectionProps) {
  const { t } = useTranslation("projects");
  const pinnedQuery = usePinnedItems(projectId);
  const pinned = pinnedQuery.data ?? [];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{t("overview.pinned")}</CardTitle>
      </CardHeader>
      <CardContent>
        {pinnedQuery.isLoading
          ? <p className="text-sm text-muted-foreground">{t("overview.pinnedLoading")}</p>
          : pinned.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.noPinned")}</p>
            : (
                <ul className="divide-y rounded-md border">
                  {pinned.map(item => (
                    <PinnedRow key={item.id} item={item} caps={caps} onOpenTab={onOpenTab} />
                  ))}
                </ul>
              )}
      </CardContent>
    </Card>
  );
}

interface PinnedRowProps {
  readonly item: PinnedItem;
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectTab) => void;
}

function PinnedRow({ item, caps, onOpenTab }: PinnedRowProps) {
  const { t } = useTranslation("projects");
  const isIssue = item.type === "issue";
  // Procurement entries already arrive gated by the backend, but guard the click
  // target so a hidden tab is never navigable.
  const target: ProjectTab = isIssue ? "issues" : "procurement";
  const canOpen = isIssue || caps.canViewProcurement;

  return (
    <li>
      <button
        type="button"
        disabled={!canOpen}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        onClick={() => onOpenTab(target)}
      >
        <Badge variant="outline" className="shrink-0 gap-1">
          {isIssue
            ? <ClipboardList className="size-3" aria-hidden="true" />
            : <Package className="size-3" aria-hidden="true" />}
          {isIssue ? t("overview.pinKind.issue") : t("overview.pinKind.procurement")}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
        <Badge variant="secondary" className={`shrink-0 text-xs ${isIssue ? ISSUE_STATUS_BADGE[item.status as keyof typeof ISSUE_STATUS_BADGE] ?? "" : ""}`}>
          {isIssue
            ? t(`issues.status.${item.status}` as const)
            : t(`procurement.status.${item.status}` as const)}
        </Badge>
        <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}
