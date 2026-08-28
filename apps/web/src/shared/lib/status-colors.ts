// Global status color system. Maps shared status enums to global semantic
// tokens (success/warning/info + muted), consumed via the shadcn token + opacity
// idiom so a single class string covers both themes (the token flips under
// `.dark`). Project, project-section and contact surfaces all read from here so
// the same status reads the same color everywhere.

import type { ContactVisibility } from "@/shared/lib/api/contacts";
import type { ProcurementStatus } from "@/shared/lib/api/procurement";
import type { EquipmentStatus, ShipStatus } from "@/shared/lib/api/project-sections";
import type { IssueStatus } from "@/shared/lib/api/projects";

/** active vs archived record chip (every project-domain record). */
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

// Issue status icon tint: the foreground-only counterpart of ISSUE_STATUS_BADGE
// for inline glyphs (no chip background). It tracks the badge's `text-*` token
// for every state EXCEPT `cancel`, which deliberately drops to /60 opacity so a
// cancelled glyph reads fainter than a muted chip. Kept beside the badge so the
// two stay aligned, but not derived from it because of that one divergence.
export const ISSUE_STATUS_ICON_TINT: Record<IssueStatus, string> = {
  todo: "text-warning",
  working: "text-info",
  review: "text-primary",
  done: "text-success",
  cancel: "text-muted-foreground/60",
};

/** Vessel lifecycle chip colors (the `ship-profile` section), one hue per state. */
export const SHIP_STATUS_BADGE: Record<ShipStatus, string> = {
  under_construction: "bg-primary/10 text-primary",
  active: "bg-success/10 text-success",
  underway: "bg-info text-info-foreground",
  in_maintenance: "bg-warning/10 text-warning",
  laid_up: "bg-muted text-muted-foreground",
  retired: "bg-muted-foreground/15 text-muted-foreground",
};

/** Equipment status chip (in-service vs retired), same hues as records. */
export const EQUIPMENT_STATUS_BADGE: Record<EquipmentStatus, string> = {
  active: RECORD_STATUS_BADGE.active,
  retired: RECORD_STATUS_BADGE.archived,
};

// Cron run/job status → shadcn Badge variant. Not a Tailwind class map like the
// others (cron badges pick a built-in variant, not a token+opacity hue).
export const CRON_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  stopped: "secondary",
  paused: "secondary",
  error: "destructive",
  disabled: "outline",
  not_loaded: "outline",
  success: "default",
  failed: "destructive",
};

// Procurement order status chip (10-status vocabulary). Maps the lifecycle to
// the same semantic-token hue families as the issue badge: pending (warning) →
// in-flight (info) → confirmed/paid (primary) → arrived/closed (success) →
// returned/refunded (destructive, the reversal flow) → cancelled (muted). Phases
// that carry two states use the tinted token (pale chip) for the earlier state
// and the SOLID token (filled chip) for the later — keeping every state on its
// phase hue yet visually distinct: ordered (info tint) vs in_transit (info
// solid); confirmed (primary tint) vs paid (primary solid); received (success
// tint) vs accepted (success solid); returned vs refunded share the destructive
// hue at two tint strengths.
export const PROCUREMENT_STATUS_BADGE: Record<ProcurementStatus, string> = {
  requested: "bg-warning/10 text-warning",
  ordered: "bg-info/10 text-info",
  confirmed: "bg-primary/10 text-primary",
  paid: "bg-primary text-primary-foreground",
  in_transit: "bg-info text-info-foreground",
  received: "bg-success/10 text-success",
  accepted: "bg-success text-success-foreground",
  returned: "bg-destructive/10 text-destructive",
  refunded: "bg-destructive/20 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};
