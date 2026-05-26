// Global status color system. Maps shared status enums to global semantic
// tokens (success/warning/info + muted), consumed via the shadcn token + opacity
// idiom so a single class string covers both themes (the token flips under
// `.dark`). Ship, project, and contact modules all read from here so the same
// status reads the same color everywhere.

import type { IssueStatus } from "@/shared/lib/api/projects";

/** active vs archived record chip (projects + ships). */
export const RECORD_STATUS_BADGE: Record<"active" | "archived", string> = {
  active: "bg-success/10 text-success",
  archived: "bg-muted text-muted-foreground",
};

/** Issue / maintenance-order status chip. */
export const ISSUE_STATUS_BADGE: Record<IssueStatus, string> = {
  open: "bg-warning/10 text-warning",
  in_progress: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
  cancelled: "bg-muted text-muted-foreground",
};
