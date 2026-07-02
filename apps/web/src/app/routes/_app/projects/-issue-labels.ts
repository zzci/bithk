// Static label-key maps for the issue status/priority enums. Exhaustive
// `Record<Enum, string>` maps (instead of dynamic `t(`...${v}`)` template keys)
// keep every locale key visible to the i18n static analyzer (check-i18n), so
// unused-key detection stays trustworthy.

import type { IssuePriority, IssueStatus } from "@/shared/lib/api/projects";

export const ISSUE_STATUSES: readonly IssueStatus[] = ["todo", "working", "review", "done", "cancel"];
export const ISSUE_PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];

export const ISSUE_STATUS_LABEL_KEY: Record<IssueStatus, string> = {
  todo: "projects:issues.status.todo",
  working: "projects:issues.status.working",
  review: "projects:issues.status.review",
  done: "projects:issues.status.done",
  cancel: "projects:issues.status.cancel",
};

export const ISSUE_PRIORITY_LABEL_KEY: Record<IssuePriority, string> = {
  low: "projects:issues.priority.low",
  medium: "projects:issues.priority.medium",
  high: "projects:issues.priority.high",
  urgent: "projects:issues.priority.urgent",
};
