// Canonical colored chips for the ship module. Color data lives in
// `-ship-colors.ts`; this file only exports components so fast-refresh stays
// happy.

import type { ShipStatus } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { SHIP_STATUS_BADGE } from "./-ship-colors";

interface ShipStatusBadgeProps {
  readonly status: ShipStatus;
  readonly className?: string;
}

/** The canonical ship-status chip, colored by status. */
export function ShipStatusBadge({ status, className }: ShipStatusBadgeProps) {
  const { t } = useTranslation("ships");
  return (
    <Badge variant="secondary" className={cn(SHIP_STATUS_BADGE[status], className)}>
      {t(`status.${status}` as const)}
    </Badge>
  );
}
