// Single source of truth for the ship module's color system. Ship and
// maintenance status map to a global semantic token (success for active,
// muted for archived / retired), consumed via the shadcn token + opacity idiom
// so a single class string covers both themes (the token flips under `.dark`).

import type { ShipStatus } from "@/shared/lib/api/ships";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";

export { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";

/** Ship status chip colors (active vessel vs archived record). */
export const SHIP_STATUS_BADGE: Record<ShipStatus, string> = RECORD_STATUS_BADGE;
