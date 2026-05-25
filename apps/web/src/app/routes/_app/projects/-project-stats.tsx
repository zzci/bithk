// Small presentational building blocks shared across the projects module's
// redesigned content pages: the list KPI strip, the detail hero metrics, and
// the issues/procurement summary strips. Pure display — no data fetching.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface StatCardProps {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly icon?: LucideIcon;
  readonly tone?: "default" | "muted";
  /** When set, the tile becomes a toggle button (used as a filter chip). */
  readonly onClick?: () => void;
  readonly active?: boolean;
}

/** A single bordered KPI/metric tile, optionally interactive as a filter chip. */
export function StatCard({ label, value, icon: Icon, tone = "default", onClick, active }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "muted" && "text-muted-foreground")}>
        {value}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "rounded-lg border bg-card px-3 py-2.5 text-left ring-1 ring-foreground/5 transition-colors",
          "hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "border-primary bg-primary/5 ring-primary/20",
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 ring-1 ring-foreground/5">
      {body}
    </div>
  );
}

interface StatStripProps {
  /** Tailwind grid template; defaults to the 4 -> 2 -> 1 KPI cadence. */
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** Responsive grid wrapper for a row of {@link StatCard}s. */
export function StatStrip({ className, children }: StatStripProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}
