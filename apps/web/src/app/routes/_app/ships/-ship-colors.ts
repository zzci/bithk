// Single source of truth for the ship module's color system. The ship lifecycle
// has six states, each mapped to a distinct global semantic token, consumed via
// the shadcn token + opacity idiom so a single class string covers both themes
// (the token flips under `.dark`). Equipment status (a separate in-service vs
// retired enum) keeps the shared record hues.

import type { EquipmentStatus, ShipStatus } from "@/shared/lib/api/ships";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";

/** Ship lifecycle chip colors, one distinct hue per state. */
export const SHIP_STATUS_BADGE: Record<ShipStatus, string> = {
  under_construction: "bg-primary/10 text-primary",
  active: "bg-success/10 text-success",
  underway: "bg-info text-info-foreground",
  in_maintenance: "bg-warning/10 text-warning",
  laid_up: "bg-muted text-muted-foreground",
  retired: "bg-muted-foreground/15 text-muted-foreground",
};

/** Equipment status chip colors (in-service vs retired), same hues as records. */
export const EQUIPMENT_STATUS_BADGE: Record<EquipmentStatus, string> = {
  active: RECORD_STATUS_BADGE.active,
  retired: RECORD_STATUS_BADGE.archived,
};
