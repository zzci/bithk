// Settings tab body: per-ship configuration surfaces. Currently the ship's own
// equipment-category set; a parity home for future per-ship settings.

import type { ShipView } from "@/shared/lib/api/ships";
import { ShipEquipmentCategoriesSection } from "./-ship-equipment-categories";

interface ShipSettingsTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

export function ShipSettingsTab({ ship, canManage }: ShipSettingsTabProps) {
  return (
    <div className="space-y-6">
      <ShipEquipmentCategoriesSection shipShortId={ship.id} canManage={canManage} />
    </div>
  );
}
