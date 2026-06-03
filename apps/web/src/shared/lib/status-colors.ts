// Global status color system. Maps shared status enums to global semantic
// tokens (success/warning/info + muted), consumed via the shadcn token + opacity
// idiom so a single class string covers both themes (the token flips under
// `.dark`). Ship, project, and contact modules all read from here so the same
// status reads the same color everywhere.

import type { ContactVisibility } from "@/shared/lib/api/contacts";
import type { ProcurementStatus } from "@/shared/lib/api/procurement";
import type { IssueStatus } from "@/shared/lib/api/projects";

/** active vs archived record chip (projects + ships). */
export const RECORD_STATUS_BADGE: Record<"active" | "archived", string> = {
  active: "bg-success/10 text-success",
  archived: "bg-muted text-muted-foreground",
};

/** Contact visibility chip: public is highlighted, private reads muted. */
export const CONTACT_VISIBILITY_BADGE: Record<ContactVisibility, string> = {
  public: "bg-info/10 text-info",
  private: "bg-muted text-muted-foreground",
};

/** Confidential-contact marker chip. */
export const CONTACT_CONFIDENTIAL_BADGE = "bg-warning/10 text-warning";

/** Issue status chip. */
export const ISSUE_STATUS_BADGE: Record<IssueStatus, string> = {
  todo: "bg-warning/10 text-warning",
  working: "bg-info/10 text-info",
  review: "bg-primary/10 text-primary",
  done: "bg-success/10 text-success",
  cancel: "bg-muted text-muted-foreground",
};

// Procurement order status chip (7-status vocabulary). Maps the lifecycle to
// the same semantic-token hue families as the issue badge: pending (warning) →
// in-flight (info) → confirmed (primary) → arrived/closed (success) → cancelled
// (muted). Each phase has two lifecycle states, so the later state of a phase
// uses the SOLID token (filled chip) while the earlier uses the tinted token
// (pale chip) — keeping every state on its phase hue yet visually distinct:
// ordered (info tint) vs in_transit (info solid); received (success tint) vs
// accepted (success solid).
export const PROCUREMENT_STATUS_BADGE: Record<ProcurementStatus, string> = {
  requested: "bg-warning/10 text-warning",
  ordered: "bg-info/10 text-info",
  confirmed: "bg-primary/10 text-primary",
  in_transit: "bg-info text-info-foreground",
  received: "bg-success/10 text-success",
  accepted: "bg-success text-success-foreground",
  cancelled: "bg-muted text-muted-foreground",
};
