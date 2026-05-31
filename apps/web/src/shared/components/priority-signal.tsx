// Shared source of truth for priority visuals across issues and procurement.
// Both IssuePriority and ProcurementPriority are exactly this four-level union,
// so a local `Priority` type keeps this module free of cross-feature imports.
// Each level is distinguished by BOTH icon and color (scheme A) so adjacent
// levels — notably low (gray) vs medium (blue) — are never ambiguous.

import { AlertTriangle, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { cn } from "@/shared/lib/utils";

type Priority = "low" | "medium" | "high" | "urgent";

// Kept module-private: exporting a non-component from this file would trip
// react-refresh/only-export-components, and the two consumers need only the
// components below. It remains the single source of truth for priority visuals.
const PRIORITY_META: Record<Priority, { readonly Icon: typeof SignalLow; readonly tone: string }> = {
  low: { Icon: SignalLow, tone: "text-muted-foreground" },
  medium: { Icon: SignalMedium, tone: "text-info" },
  high: { Icon: SignalHigh, tone: "text-warning" },
  urgent: { Icon: AlertTriangle, tone: "text-destructive" },
};

export function PrioritySignal({ priority, label }: { readonly priority: Priority; readonly label: string }) {
  const { Icon, tone } = PRIORITY_META[priority];
  return (
    <span className="inline-flex shrink-0" title={label} aria-label={label}>
      <Icon aria-hidden="true" className={cn("size-3.5", tone)} />
    </span>
  );
}

/** Bare priority icon for the create dialog's pill/selector (no title wrapper). */
export function PriorityGlyph({ priority }: { readonly priority: Priority }) {
  const { Icon, tone } = PRIORITY_META[priority];
  return <Icon aria-hidden="true" className={cn("size-4", tone)} />;
}
