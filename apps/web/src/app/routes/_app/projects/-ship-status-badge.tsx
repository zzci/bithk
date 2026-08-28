// Canonical colored chip for the vessel lifecycle status carried by the
// `ship-profile` section. Distinct from the project's own active/archived
// chip (`RECORD_STATUS_BADGE`): this one describes the vessel, not the record.
// Color data lives in the global `status-colors` source.

import type { ShipStatus } from "@/shared/lib/api/project-sections";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { SHIP_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";

interface ShipStatusBadgeProps {
  readonly status: ShipStatus;
  readonly className?: string;
}

export function ShipStatusBadge({ status, className }: ShipStatusBadgeProps) {
  const { t } = useTranslation("ships");
  return (
    <Badge variant="secondary" className={cn(SHIP_STATUS_BADGE[status], className)}>
      {t(`status.${status}` as const)}
    </Badge>
  );
}
