// Small presentational stat tile shared by the ship detail hero metrics and the
// overview quick-stats card. Pure display — every value passed in is derived
// from real ship data by the caller. An optional colored icon tile (driven by
// the ship color system) gives each metric a distinct hue.

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface StatTileProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly icon?: ReactNode;
  /** Tailwind classes for the icon tile background + text (from `LIFECYCLE_STYLES`). */
  readonly accent?: string;
  readonly className?: string;
}

export function StatTile({ label, value, hint, icon, accent, className }: StatTileProps) {
  return (
    <div className={cn("rounded-lg border bg-card px-4 py-3", className)}>
      <div className="flex items-center gap-2">
        {icon != null && (
          <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5", accent)}>
            {icon}
          </span>
        )}
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1.5 text-2xl leading-none font-semibold tabular-nums">{value}</p>
      {hint != null && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
