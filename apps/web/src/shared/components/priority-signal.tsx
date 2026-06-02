// Shared source of truth for priority visuals across issues and procurement.
// Both IssuePriority and ProcurementPriority are exactly this four-level union,
// so a local `Priority` type keeps this module free of cross-feature imports.
// Each level renders a background-backed signal-bar icon: a tinted rounded chip
// holding a solid-color lucide Signal* glyph. The bar count (low→urgent) plus the
// token color keep adjacent levels — notably medium (blue) vs high (yellow) —
// unambiguous at a glance.

import type { LucideIcon } from "lucide-react";

import { Signal, SignalHigh, SignalLow, SignalMedium } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type Priority = "low" | "medium" | "high" | "urgent";

interface PriorityVisual {
  readonly Icon: LucideIcon;
  readonly icon: string; // solid token color for the glyph
  readonly chip: string; // tinted token background for the chip
}

// Kept module-private: exporting a non-component from this file would trip
// react-refresh/only-export-components, and the two consumers need only the
// components below. It remains the single source of truth for priority visuals.
const PRIORITY_META: Record<Priority, PriorityVisual> = {
  low: { Icon: SignalLow, icon: "text-muted-foreground", chip: "bg-muted-foreground/15" },
  medium: { Icon: SignalMedium, icon: "text-info", chip: "bg-info/15" },
  high: { Icon: SignalHigh, icon: "text-warning", chip: "bg-warning/15" },
  urgent: { Icon: Signal, icon: "text-destructive", chip: "bg-destructive/15" },
};

function PriorityChip({ priority }: { readonly priority: Priority }) {
  const { Icon, icon, chip } = PRIORITY_META[priority];
  return (
    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-md", chip)}>
      <Icon aria-hidden="true" className={cn("size-3", icon)} />
    </span>
  );
}

export function PrioritySignal({ priority, label }: { readonly priority: Priority; readonly label: string }) {
  return (
    <span role="img" title={label} aria-label={label}>
      <PriorityChip priority={priority} />
    </span>
  );
}

/** Bare priority chip for the create dialog's pill/selector (no title wrapper). */
export function PriorityGlyph({ priority }: { readonly priority: Priority }) {
  return (
    <span aria-hidden="true">
      <PriorityChip priority={priority} />
    </span>
  );
}
