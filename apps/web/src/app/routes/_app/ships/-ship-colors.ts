// Ship-module color bindings. The ship lifecycle hues now live in the global
// `status-colors` source; this file re-exports them so ship-local importers keep
// a single ship entry point, and adds the equipment-status mapping. Equipment
// status (a separate in-service vs retired enum) keeps the shared record hues.

import type { EquipmentStatus } from "@/shared/lib/api/ships";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";

export { SHIP_STATUS_BADGE } from "@/shared/lib/status-colors";

/** Equipment status chip colors (in-service vs retired), same hues as records. */
export const EQUIPMENT_STATUS_BADGE: Record<EquipmentStatus, string> = {
  active: RECORD_STATUS_BADGE.active,
  retired: RECORD_STATUS_BADGE.archived,
};
