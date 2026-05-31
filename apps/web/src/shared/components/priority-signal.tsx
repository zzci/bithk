// Shared source of truth for priority visuals across issues and procurement.
// Both IssuePriority and ProcurementPriority are exactly this four-level union,
// so a local `Priority` type keeps this module free of cross-feature imports.
// Each level is a solid filled circle colored per level (scheme A) so adjacent
// levels — notably low (gray) vs medium (blue) — are never ambiguous.

import { cn } from "@/shared/lib/utils";

type Priority = "low" | "medium" | "high" | "urgent";

// Kept module-private: exporting a non-component from this file would trip
// react-refresh/only-export-components, and the two consumers need only the
// components below. It remains the single source of truth for priority visuals.
const PRIORITY_META: Record<Priority, string> = {
  low: "bg-muted-foreground",
  medium: "bg-info",
  high: "bg-warning",
  urgent: "bg-destructive",
};

export function PrioritySignal({ priority, label }: { readonly priority: Priority; readonly label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("inline-block size-2.5 shrink-0 rounded-full", PRIORITY_META[priority])}
    />
  );
}

/** Bare priority dot for the create dialog's pill/selector (no title wrapper). */
export function PriorityGlyph({ priority }: { readonly priority: Priority }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 rounded-full", PRIORITY_META[priority])} />;
}
