// Overview tab: a restrained work-focused dashboard. A unified project
// information card (creator, last updated, tags, and description), a mixed
// pinned-items card, and the latest work orders + procurements grouped into
// separate cards. Read-only — pinning happens on the rows in the Issues /
// Procurement tabs.

import type { ReactNode } from "react";
import type { ProjectCapabilityInfo } from "./-use-project-role";
import type { PinnedItem } from "@/shared/lib/api/pins";
import type { ProjectView } from "@/shared/lib/api/projects";
import { ClipboardList, Package, Pin } from "lucide-react";
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
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectTab) => void;
}

export function ProjectOverviewTab({ project, caps, onOpenTab }: ProjectOverviewTabProps) {
  const { t } = useTranslation("projects");

  const latestIssuesQuery = useProjectIssues(project.id, { limit: 5 });
  const latestProcurementsQuery = useProcurements(project.id, { limit: 5 }, caps.canViewProcurement);

  const showProcurement = caps.canViewProcurement;

  return (
    <div className="space-y-6">
      <ProjectInfoCard description={project.description} />

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

interface ProjectInfoCardProps {
  readonly description: string | null;
}

function ProjectInfoCard({ description }: ProjectInfoCardProps) {
  const { t } = useTranslation("projects");

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">{t("overview.description")}</span>
        <p className="max-w-prose text-sm leading-relaxed break-words whitespace-pre-wrap">
          {description || <span className="text-muted-foreground">{t("overview.noDescription")}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

// Shared list presentation for the pinned + latest-activity sections: one row
// rhythm (title first, then a wrapping metadata line) and intentional muted
// loading/empty states instead of loose body text.
const ROW_BUTTON_CLASS
  = "group flex w-full flex-col items-start gap-1.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ListState({ children }: { readonly children: ReactNode }) {
  return (
    <p className="px-2 py-6 text-center text-sm text-pretty text-muted-foreground">{children}</p>
  );
}

function RowMeta({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {children}
    </span>
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
          ? <ListState>{t("overview.pinnedLoading")}</ListState>
          : pinned.length === 0
            ? <ListState>{t("overview.noPinned")}</ListState>
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
        className={cn(ROW_BUTTON_CLASS, "disabled:pointer-events-none disabled:opacity-60")}
        onClick={() => onOpenTab(target)}
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>
          <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        <RowMeta>
          <Badge variant="outline" className="shrink-0 gap-1">
            {isIssue
              ? <ClipboardList className="size-3" aria-hidden="true" />
              : <Package className="size-3" aria-hidden="true" />}
            {isIssue ? t("overview.pinKind.issue") : t("overview.pinKind.procurement")}
          </Badge>
          <Badge
            variant="secondary"
            className={cn("shrink-0", isIssue ? ISSUE_STATUS_BADGE[item.status as keyof typeof ISSUE_STATUS_BADGE] ?? "" : "")}
          >
            {isIssue
              ? t(`issues.status.${item.status}` as const)
              : t(`procurement.status.${item.status}` as const)}
          </Badge>
          <span className="ml-auto shrink-0">{formatDate(item.pinnedAt)}</span>
        </RowMeta>
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
          ? <ListState>{loadingText}</ListState>
          : isEmpty
            ? <ListState>{emptyText}</ListState>
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
        className={ROW_BUTTON_CLASS}
        onClick={onClick}
      >
        <span className="w-full truncate text-sm font-medium text-foreground">{title}</span>
        <RowMeta>
          {badge}
          <span className="ml-auto shrink-0">{date}</span>
        </RowMeta>
      </button>
    </li>
  );
}
