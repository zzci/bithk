// Global status color system. Maps shared status enums to global semantic
// tokens (success/warning/info + muted), consumed via the shadcn token + opacity
// idiom so a single class string covers both themes (the token flips under
// `.dark`). Ship, project, and contact modules all read from here so the same
// status reads the same color everywhere.

import type { ProcurementStatus } from "@/shared/lib/api/procurement";
import type { IssueStatus } from "@/shared/lib/api/projects";

/** active vs archived record chip (projects + ships). */
export const RECORD_STATUS_BADGE: Record<"active" | "archived", string> = {
  active: "bg-success/10 text-success",
  archived: "bg-muted text-muted-foreground",
};

/** Issue / maintenance-order status chip. */
export const ISSUE_STATUS_BADGE: Record<IssueStatus, string> = {
  todo: "bg-warning/10 text-warning",
  working: "bg-info/10 text-info",
  review: "bg-primary/10 text-primary",
  done: "bg-success/10 text-success",
  cancel: "bg-muted text-muted-foreground",
};

// Procurement order status chip (7-status vocabulary). Maps the lifecycle to
// the same semantic tokens as the issue badge: pending (warning) → in-flight
// (info) → confirmed (primary) → arrived/closed (success) → cancelled (muted).
export const PROCUREMENT_STATUS_BADGE: Record<ProcurementStatus, string> = {
  requested: "bg-warning/10 text-warning",
  ordered: "bg-info/10 text-info",
  confirmed: "bg-primary/10 text-primary",
  in_transit: "bg-info/10 text-info",
  received: "bg-success/10 text-success",
  accepted: "bg-success/10 text-success",
  cancelled: "bg-muted text-muted-foreground",
};
