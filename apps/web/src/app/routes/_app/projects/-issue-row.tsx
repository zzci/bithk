// Row widgets for the issues (work orders) tab: the memoized list row plus its
// leaf pieces (inline status glyph, assignee avatar, relative due-date label,
// pin toggle). Extracted from -project-issues-tab.tsx so the list stays under
// the file-size cap and rows skip re-rendering when unrelated state changes.

import type { IssueStatus, ProjectIssueRow } from "@/shared/lib/api/projects";
import { User } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PinToggle } from "@/shared/components/pin-toggle";
import { PrioritySignal } from "@/shared/components/priority-signal";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { useToggleIssuePin } from "@/shared/lib/api/pins";
import { errorMessage } from "@/shared/lib/errors";
import { ISSUE_STATUS_ICON_TINT } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";

// One shared grid template for every row in a status group so cells line up
// vertically across rows. Tracks (left to right):
//   [status+id] [title 1fr] [tags (sm+)] [due (md+)] [assignee] [priority]
// Hidden cells use display:none and drop out of grid flow, so the count of
// visible cells matches the track count at each breakpoint. The title (1fr)
// absorbs all slack, keeping the trailing meta columns right-aligned across
// rows regardless of id/tag width.
const ROW_GRID_CLASS
  = "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] md:grid-cols-[auto_minmax(0,1fr)_auto_5rem_auto_auto]";

// Distinct avatar background palette (deterministic per member id). Uses the
// -700 shade across all hues so white initials clear the 4.5:1 AA contrast
// ratio even at the 10px avatar size (the -500 shades failed for amber/sky/teal).
const AVATAR_COLORS = [
  "bg-rose-700",
  "bg-orange-700",
  "bg-amber-700",
  "bg-emerald-700",
  "bg-teal-700",
  "bg-sky-700",
  "bg-indigo-700",
  "bg-violet-700",
  "bg-fuchsia-700",
  "bg-pink-700",
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0)
    return "?";
  if (parts.length === 1)
    return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

// Status glyphs drawn inline so they read identically across lucide versions:
// empty circle (todo), half-filled (working), center dot (review), check (done),
// slash (cancel).
export function StatusIcon({ status, label }: { readonly status: IssueStatus; readonly label: string }) {
  const tint = ISSUE_STATUS_ICON_TINT[status];
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", tint)} role="img" aria-label={label}>
      {status === "done"
        ? (
            <>
              <circle cx="8" cy="8" r="7" fill="currentColor" />
              <path d="M4.7 8.2l2.2 2.2 4.4-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )
        : (
            <>
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              {status === "working" && (
                <path d="M8 8 V2 A6 6 0 0 1 8 14 Z" fill="currentColor" />
              )}
              {status === "review" && (
                <circle cx="8" cy="8" r="2.5" fill="currentColor" />
              )}
              {status === "cancel" && (
                <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </>
          )}
    </svg>
  );
}

function MemberAvatar({ id, label }: { readonly id: string | null; readonly label: string }) {
  if (!id) {
    return (
      <span
        title={label}
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40"
      >
        <User aria-hidden="true" className="size-3 text-muted-foreground/50" />
      </span>
    );
  }
  return (
    <span
      title={label}
      className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-medium text-white", avatarColor(id))}
    >
      {initialsOf(label)}
    </span>
  );
}

// Start-of-day timestamp for "now", captured once per mount (kept out of render
// to stay pure; the relative label does not need to tick within a session).
function useStartOfToday(): number {
  const [todayTs] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  return todayTs;
}

// Relative due date with an overdue/today accent. `value` is a YYYY-MM-DD date.
function DueLabel({ value }: { readonly value: string }) {
  const { t } = useTranslation("projects");
  const todayTs = useStartOfToday();
  const parts = value.split("-").map(Number);
  const due = new Date(parts[0]!, (parts[1]! - 1), parts[2]!);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - todayTs) / 86_400_000);

  let text: string;
  let tone = "text-muted-foreground";
  if (diff < 0) {
    text = t("issues.due.overdue", { count: -diff });
    tone = "text-destructive";
  }
  else if (diff === 0) {
    text = t("issues.due.today");
    tone = "text-warning";
  }
  else if (diff === 1) {
    text = t("issues.due.tomorrow");
  }
  else {
    text = t("issues.due.inDays", { count: diff });
  }

  return (
    <span title={value} className={cn("shrink-0 whitespace-nowrap tabular-nums", tone)}>
      {text}
    </span>
  );
}

interface IssuePinToggleProps {
  readonly projectId: string;
  readonly issue: ProjectIssueRow;
}

/** Ghost icon toggle that pins/unpins an issue, with success/error toasts. */
function IssuePinToggle({ projectId, issue }: IssuePinToggleProps) {
  const { t } = useTranslation(["projects", "common"]);
  const togglePin = useToggleIssuePin();
  return (
    <PinToggle
      pinned={issue.pinned}
      pending={togglePin.isPending}
      stopPropagation
      onToggle={(willPin) => {
        togglePin.mutate({ projectId, id: issue.id, pin: willPin }, {
          onSuccess: () => toast.success(t(willPin ? "toast.issuePinned" : "toast.issueUnpinned")),
          onError: err => toast.error(errorMessage(err, t("common:common.error.operationFailed"))),
        });
      }}
    />
  );
}

interface IssueRowProps {
  readonly projectId: string;
  readonly issue: ProjectIssueRow;
  /** Localized label of the issue's status (used by the row's status glyph). */
  readonly statusLabel: string;
  readonly priorityLabel: string;
  readonly assigneeLabel: string;
  /** The row's drawer is currently open — keep it highlighted. */
  readonly active: boolean;
  readonly canPin: boolean;
  readonly onOpen: (issueId: string) => void;
}

// Memoized so a state change elsewhere in the tab (search text, collapse
// toggles, dialog open) does not re-render every row; `onOpen` must be a
// stable callback for the memo to hold.
export const IssueRow = memo(({
  projectId,
  issue,
  statusLabel,
  priorityLabel,
  assigneeLabel,
  active,
  canPin,
  onOpen,
}: IssueRowProps) => {
  // Defensive: a contract-violating / stale-cache row may lack `tags`.
  const issueTags = issue.tags ?? [];
  return (
    <li
      className={cn(
        "group flex items-center rounded-md border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/50",
        active && "bg-muted/60",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        className={cn(
          ROW_GRID_CLASS,
          "h-auto min-w-0 flex-1 shrink items-center gap-x-3 rounded-md px-2 py-1.5 text-left font-normal hover:bg-transparent",
        )}
        onClick={() => onOpen(issue.id)}
      >
        {/* status + id share the leading column */}
        <span className="flex items-center gap-2.5">
          <StatusIcon status={issue.status} label={statusLabel} />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{issue.id}</span>
        </span>
        <span className="min-w-0 truncate text-sm">{issue.title}</span>
        {/* tags column — always rendered (empty when none) so every row keeps the shared template */}
        <div className="hidden items-center gap-1 sm:flex">
          {issueTags.slice(0, 3).map(tag => (
            <Badge key={tag.id} variant="secondary" className="h-5 px-1.5 text-2xs font-normal">
              {tag.name}
            </Badge>
          ))}
        </div>
        {/* due column — md+ only, always rendered to preserve its grid track */}
        <div className="hidden justify-end text-xs md:flex">
          {issue.dueDate && <DueLabel value={issue.dueDate} />}
        </div>
        <MemberAvatar id={issue.assigneeMemberId} label={assigneeLabel} />
        <PrioritySignal priority={issue.priority} label={priorityLabel} />
      </Button>
      {canPin && (
        <div
          className={cn(
            "shrink-0 pr-1 transition-opacity",
            issue.pinned ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100",
          )}
        >
          <IssuePinToggle projectId={projectId} issue={issue} />
        </div>
      )}
    </li>
  );
});
