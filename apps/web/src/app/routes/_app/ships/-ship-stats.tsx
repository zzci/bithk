// Small presentational stat tile shared by the ships list KPI strip, the
// detail hero metrics, and the overview quick-stats card. Pure display — every
// value passed in is derived from real ship data by the caller.

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface StatTileProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  readonly className?: string;
}

export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div className={cn("rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/5", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl leading-none font-semibold tabular-nums">{value}</p>
      {hint != null && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
