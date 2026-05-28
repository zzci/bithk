// Overview tab: a restrained work-focused dashboard. A summary card (creator,
// last updated, tags, and compact work-order / procurement metrics), the
// project description, a mixed pinned-items card, and the latest work orders +
// procurements grouped into separate cards. Read-only — pinning happens on the
// rows in the Issues / Procurement tabs.

import type { ReactNode } from "react";
import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { PinnedItem } from "@/shared/lib/api/pins";
import type { ProjectView } from "@/shared/lib/api/projects";
import { ClipboardList, Clock, Package, Pin, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { usePinnedItems } from "@/shared/lib/api/pins";
import { useProcurements } from "@/shared/lib/api/procurement";
import { useProjectIssues } from "@/shared/lib/api/projects";
import { formatDate } from "@/shared/lib/format";
import { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";

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

  const issuesCount = latestIssuesQuery.data?.meta.total;
  const procurementCount = latestProcurementsQuery.data?.meta.total;
  const showProcurement = caps.canViewProcurement;

  return (
    <div className="space-y-6">
      <ProjectSummaryCard
        creatorName={userNames.get(project.creatorId) ?? project.creatorId}
        updatedAt={project.updatedAt}
        tags={project.tags}
        issuesCount={issuesCount}
        procurementCount={procurementCount}
        showProcurement={showProcurement}
      />

      <ProjectDescriptionCard description={project.description} />

      <ProjectPinnedCard projectId={project.id} caps={caps} onOpenTab={onOpenTab} />

      <div className={cn("grid gap-4", showProcurement && "lg:grid-cols-2")}>
        <LatestActivityCard
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
          title={t("overview.latestIssues")}
          onViewAll={() => onOpenTab("issues")}
          isLoading={latestIssuesQuery.isLoading}
          loadingText={t("issues.loading")}
          isEmpty={(latestIssuesQuery.data?.data.length ?? 0) === 0}
          emptyText={t("issues.empty")}
        >
          {latestIssuesQuery.data?.data.map(issue => (
            <ActivityRow
              key={issue.id}
              title={issue.title}
              date={formatDate(issue.updatedAt)}
              onClick={() => onOpenTab("issues")}
              badge={(
                <Badge variant="secondary" className={cn("shrink-0", ISSUE_STATUS_BADGE[issue.status])}>
                  {t(`issues.status.${issue.status}` as const)}
                </Badge>
              )}
            />
          ))}
        </LatestActivityCard>

        {showProcurement && (
          <LatestActivityCard
            icon={<Package className="size-4" aria-hidden="true" />}
            title={t("overview.latestProcurements")}
            onViewAll={() => onOpenTab("procurement")}
            isLoading={latestProcurementsQuery.isLoading}
            loadingText={t("procurement.loading")}
            isEmpty={(latestProcurementsQuery.data?.data.length ?? 0) === 0}
            emptyText={t("procurement.empty")}
          >
            {latestProcurementsQuery.data?.data.map(p => (
              <ActivityRow
                key={p.id}
                title={p.itemName}
                date={formatDate(p.updatedAt)}
                onClick={() => onOpenTab("procurement")}
                badge={(
                  <Badge variant="outline" className="shrink-0">
                    {t(`procurement.status.${p.status}` as const)}
                  </Badge>
                )}
              />
            ))}
          </LatestActivityCard>
        )}
      </div>
    </div>
  );
}

interface ProjectSummaryCardProps {
  readonly creatorName: string;
  readonly updatedAt: string;
  readonly tags: ProjectView["tags"];
  readonly issuesCount: number | undefined;
  readonly procurementCount: number | undefined;
  readonly showProcurement: boolean;
}

function ProjectSummaryCard({ creatorName, updatedAt, tags, issuesCount, procurementCount, showProcurement }: ProjectSummaryCardProps) {
  const { t } = useTranslation("projects");

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5 shrink-0" aria-hidden="true" />
              {t("overview.creator")}
              {": "}
              {creatorName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              {t("overview.updatedAt")}
              {": "}
              {formatDate(updatedAt)}
            </span>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="text-xs">{tag.name}</Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:shrink-0">
          <SummaryMetric
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
            value={issuesCount}
            label={t("detail.metrics.issues")}
          />
          {showProcurement && (
            <SummaryMetric
              icon={<Package className="size-4" aria-hidden="true" />}
              value={procurementCount}
              label={t("detail.metrics.procurement")}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SummaryMetricProps {
  readonly icon: ReactNode;
  readonly value: number | undefined;
  readonly label: string;
}

function SummaryMetric({ icon, value, label }: SummaryMetricProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-semibold tabular-nums text-foreground">{value ?? "—"}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function ProjectDescriptionCard({ description }: { readonly description: string | null }) {
  const { t } = useTranslation("projects");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{t("overview.description")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-prose text-sm leading-relaxed break-words whitespace-pre-wrap">
          {description || <span className="text-muted-foreground">{t("overview.noDescription")}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

interface ProjectPinnedCardProps {
  readonly projectId: string;
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectTab) => void;
}

function ProjectPinnedCard({ projectId, caps, onOpenTab }: ProjectPinnedCardProps) {
  const { t } = useTranslation("projects");
  const pinnedQuery = usePinnedItems(projectId);
  const pinned = pinnedQuery.data ?? [];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Pin className="size-4" aria-hidden="true" />
          {t("overview.pinned")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pinnedQuery.isLoading
          ? <p className="text-sm text-muted-foreground">{t("overview.pinnedLoading")}</p>
          : pinned.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.noPinned")}</p>
            : (
                <ul aria-label={t("overview.pinned")} className="-mx-2 space-y-0.5">
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
        className="group flex w-full flex-col items-start gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        onClick={() => onOpenTab(target)}
      >
        <span className="flex w-full items-center gap-2">
          <Badge variant="outline" className="shrink-0 gap-1">
            {isIssue
              ? <ClipboardList className="size-3" aria-hidden="true" />
              : <Package className="size-3" aria-hidden="true" />}
            {isIssue ? t("overview.pinKind.issue") : t("overview.pinKind.procurement")}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>
          <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="secondary"
            className={cn("shrink-0", isIssue ? ISSUE_STATUS_BADGE[item.status as keyof typeof ISSUE_STATUS_BADGE] ?? "" : "")}
          >
            {isIssue
              ? t(`issues.status.${item.status}` as const)
              : t(`procurement.status.${item.status}` as const)}
          </Badge>
          <span className="ml-auto shrink-0">{formatDate(item.pinnedAt)}</span>
        </span>
      </button>
    </li>
  );
}

interface LatestActivityCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly onViewAll: () => void;
  readonly isLoading: boolean;
  readonly loadingText: string;
  readonly isEmpty: boolean;
  readonly emptyText: string;
  readonly children?: ReactNode;
}

function LatestActivityCard({ icon, title, onViewAll, isLoading, loadingText, isEmpty, emptyText, children }: LatestActivityCardProps) {
  const { t } = useTranslation("projects");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
        <CardAction>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onViewAll}>
            {t("overview.viewAll")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading
          ? <p className="text-sm text-muted-foreground">{loadingText}</p>
          : isEmpty
            ? <p className="text-sm text-muted-foreground">{emptyText}</p>
            : <ul className="-mx-2 space-y-0.5">{children}</ul>}
      </CardContent>
    </Card>
  );
}

interface ActivityRowProps {
  readonly title: string;
  readonly date: string;
  readonly badge: ReactNode;
  readonly onClick: () => void;
}

function ActivityRow({ title, date, badge, onClick }: ActivityRowProps) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClick}
      >
        <span className="w-full truncate text-sm font-medium text-foreground">{title}</span>
        <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          {badge}
          <span className="ml-auto shrink-0">{date}</span>
        </span>
      </button>
    </li>
  );
}
