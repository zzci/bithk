// Canonical colored chips for the ship module. Color data lives in
// `-ship-colors.ts`; this file only exports components so fast-refresh stays
// happy.

import type { ShipLifecycleStage, ShipStatus } from "@/shared/lib/api/ships";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { LIFECYCLE_STYLES, SHIP_STATUS_BADGE } from "./-ship-colors";

interface LifecycleBadgeProps {
  readonly stage: ShipLifecycleStage;
  /** Render the stage icon before the label. */
  readonly icon?: boolean;
  readonly className?: string;
}

/** The canonical lifecycle-stage chip, colored by stage. */
export function LifecycleBadge({ stage, icon = false, className }: LifecycleBadgeProps) {
  const { t } = useTranslation("ships");
  const style = LIFECYCLE_STYLES[stage];
  const Icon = style.icon;
  return (
    <Badge variant="secondary" className={cn(style.badge, className)}>
      {icon && <Icon />}
      {t(`lifecycle.${stage}` as const)}
    </Badge>
  );
}

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
