// Issues (work orders) tab: a Linear-style status-grouped list. Search and
// create are the primary top actions. Each status renders as a collapsible
// full-width section bar (chevron + status icon + label + count) that toggles
// its rows open/closed; there is no separate status-filter chip row. Rows are
// compact single-line buttons showing a status icon, the short id, the title,
// a priority signal, a relative due date (overdue accented), and a colored
// assignee avatar. Only fields the issue model actually exposes are shown — no
// fabricated tags or sub-issue progress. A pin toggle is kept as an isolated
// row affordance for the project pinned-home surface. The detail view (drawer /
// fullscreen) opens on row click.
//
// The create composer lives in -issue-create-dialog.tsx and the memoized row
// widgets in -issue-row.tsx; status/priority labels come from the static key
// maps in -issue-labels.ts.

import type {
  IssueStatus,
  ProjectIssueRow,
  ProjectMemberView,
} from "@/shared/lib/api/projects";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListFilter } from "@/shared/components/list-filter";
import { ListRowsSkeleton } from "@/shared/components/list-skeleton";
import { SearchCreateBar } from "@/shared/components/search-create-bar";
import { tagFilterDimension } from "@/shared/components/tags";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useIssueTags, useProjectIssues } from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { useAuthStore } from "@/shared/stores/auth";
import { CreateIssueDialog } from "./-issue-create-dialog";
import { ISSUE_PRIORITY_LABEL_KEY, ISSUE_STATUS_LABEL_KEY, ISSUE_STATUSES } from "./-issue-labels";
import { IssueRow, StatusIcon } from "./-issue-row";
import { buildMemberLabelMap } from "./-member-helpers";

interface ProjectIssuesTabProps {
  readonly projectId: string;
  readonly members: readonly ProjectMemberView[];
  readonly userNames: ReadonlyMap<string, string>;
  /** Holds `issue.manage` (admins included). Combined with the creator check to gate the pin toggle. */
  readonly canManage?: boolean;
  /** The project's ship id when it is a ship base project; enables worklist referencing. */
  readonly shipId?: string | null;
}

export function ProjectIssuesTab({ projectId, members, userNames, canManage = false, shipId = null }: ProjectIssuesTabProps) {
  const { t } = useTranslation(["projects", "common"]);
  const navigate = useNavigate();
  const currentUserId = useAuthStore(s => s.user?.id);

  // Backend gates issue pinning on admin || issue.manage || creator. Mirror that
  // here so the toggle never appears where a 403 would follow.
  const canPin = (issue: ProjectIssueRow) => canManage || issue.creatorId === currentUserId;

  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<IssueStatus>("todo");
  const [search, setSearch] = useState("");
  // Selected tag ids; empty means no tag filter. An issue matches the union of
  // the selected tags.
  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([]);
  // Per-status collapse of the section's rows (header stays visible).
  const [collapsed, setCollapsed] = useState<Partial<Record<IssueStatus, boolean>>>({});
  const debouncedSearch = useDebounce(search, 300);

  const issueTagsQuery = useIssueTags();
  const issueTags = issueTagsQuery.data ?? [];

  // The drawer is a nested route; read the active issueId (if any) so the open
  // row stays highlighted while its drawer overlays the list.
  const activeParams = useParams({ strict: false }) as { readonly issueId?: string };
  const activeIssueId = activeParams.issueId;

  const q = debouncedSearch || undefined;
  const tagIds = selectedTagIds.length > 0 ? selectedTagIds : undefined;
  // One list request (no status filter); group by status on the client. The
  // rows already carry `status`, so this collapses the former 5-per-status
  // fan-out into a single request and makes counts a client-side reduce. A high
  // limit keeps every status' rows present for grouping.
  const issuesQuery = useProjectIssues(projectId, { q, tagIds, limit: 100 });

  const memberLabels = useMemo(() => buildMemberLabelMap(members, userNames), [members, userNames]);

  const issuesByStatus = useMemo(() => {
    const map: Record<IssueStatus, ProjectIssueRow[]> = {
      todo: [],
      working: [],
      review: [],
      done: [],
      cancel: [],
    };
    for (const issue of issuesQuery.data?.data ?? [])
      map[issue.status].push(issue);
    return map;
  }, [issuesQuery.data]);

  const countOf = (status: IssueStatus) => issuesByStatus[status].length;
  const totalAll = issuesQuery.data?.data.length ?? 0;

  const loadError = issuesQuery.error;
  const isInitialLoading = issuesQuery.isLoading;
  const hasAnyIssue = totalAll > 0;

  // No status filter: always show every populated status group.
  const visibleStatuses: readonly IssueStatus[] = ISSUE_STATUSES.filter(s => countOf(s) > 0);

  const assigneeLabel = (issue: ProjectIssueRow) =>
    issue.assigneeMemberId
      ? memberLabels.get(issue.assigneeMemberId) ?? issue.assigneeMemberId
      : t("issues.unassigned");

  const openIssue = useCallback((issueId: string) => {
    void navigate({ to: "/projects/$projectId/issues/$issueId", params: { projectId, issueId } });
  }, [navigate, projectId]);

  const openCreate = (status: IssueStatus) => {
    setCreateStatus(status);
    setCreateOpen(true);
  };

  const toggleCollapse = useCallback((status: IssueStatus) =>
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] })), []);

  const tagDim = tagFilterDimension({
    tags: issueTags,
    value: selectedTagIds,
    onChange: setSelectedTagIds,
    label: t("field.tags"),
  });

  return (
    <div className="space-y-5">
      {/* Top toolbar — tag filter on the left, search + create grouped on the
          right, on a single row that wraps gracefully on narrow widths. The tag
          filter is a multi-select dropdown whose selected tags surface as
          removable chips; union semantics narrow the list to issues carrying any
          selected tag. Omitted when the project has no tags, keeping search +
          create right-aligned. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {issueTags.length > 0
          ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <ListFilter dimensions={tagDim ? [tagDim] : []} />
              </div>
            )
          : <div />}
        <SearchCreateBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t("issues.searchPlaceholder"),
          }}
          {...(canManage ? { create: { label: t("issues.create"), onClick: () => openCreate("todo") } } : {})}
        />
      </div>

      {loadError && <ErrorBanner message={errorMessage(loadError, t("common:common.error.loadFailed"))} />}

      {isInitialLoading
        ? <ListRowsSkeleton label={t("issues.loading")} />
        : loadError
          ? null
          : !hasAnyIssue
              ? <EmptyHint py="lg">{t("issues.empty")}</EmptyHint>
              : (
                  <div className="space-y-2.5">
                    {visibleStatuses.map((status) => {
                      const groupIssues = issuesByStatus[status];
                      const count = countOf(status);
                      const label = t(ISSUE_STATUS_LABEL_KEY[status]);
                      const isCollapsed = collapsed[status] ?? false;
                      return (
                        <section key={status} aria-label={label}>
                          {/* Full-width section bar: collapse chevron + status label. */}
                          <div className="flex w-full items-center gap-1 rounded-lg bg-muted/50 px-1.5 py-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-expanded={!isCollapsed}
                              aria-label={t("issues.toggleSection")}
                              className="text-muted-foreground"
                              onClick={() => toggleCollapse(status)}
                            >
                              <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")} />
                            </Button>
                            <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
                              <StatusIcon status={status} label={label} />
                              <span className="text-sm font-medium">{label}</span>
                              <span className="text-xs text-muted-foreground">{count}</span>
                            </div>
                          </div>

                          {!isCollapsed && (
                            groupIssues.length === 0
                              ? <p className="px-3 py-2 text-sm text-muted-foreground">{t("issues.emptyColumn")}</p>
                              : (
                                  <ul className="mt-0.5">
                                    {groupIssues.map(issue => (
                                      <IssueRow
                                        key={issue.id}
                                        projectId={projectId}
                                        issue={issue}
                                        statusLabel={label}
                                        priorityLabel={t(ISSUE_PRIORITY_LABEL_KEY[issue.priority])}
                                        assigneeLabel={assigneeLabel(issue)}
                                        active={activeIssueId === issue.id}
                                        canPin={canPin(issue)}
                                        onOpen={openIssue}
                                      />
                                    ))}
                                  </ul>
                                )
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}

      {canManage && (
        <CreateIssueDialog
          key={createStatus}
          projectId={projectId}
          members={members}
          memberLabels={memberLabels}
          initialStatus={createStatus}
          open={createOpen}
          onOpenChange={setCreateOpen}
          shipId={shipId}
        />
      )}
    </div>
  );
}
