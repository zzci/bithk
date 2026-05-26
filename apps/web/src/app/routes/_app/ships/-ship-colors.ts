// Single source of truth for the ship module's color system. Each lifecycle
// stage and ship/maintenance status maps to a global semantic token
// (success/warning/info/accent-design/accent-maint, plus muted for archived /
// retired), consumed via the shadcn token + opacity idiom so a single class
// string covers both themes (the token flips under `.dark`). The hero, overview
// widgets, lifecycle stepper, and the ship list all read from here so one ship
// reads the same color everywhere.

import type { LucideIcon } from "lucide-react";
import type { ShipLifecycleStage, ShipStatus } from "@/shared/lib/api/ships";
import { Anchor, CircleSlash, Hammer, PenTool, Sparkles, Wrench } from "lucide-react";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";

export { ISSUE_STATUS_BADGE } from "@/shared/lib/status-colors";

interface LifecycleStyle {
  readonly icon: LucideIcon;
  /** Chip background + text (badge). */
  readonly badge: string;
  /** Solid dot / filled stepper node. */
  readonly dot: string;
  /** Icon-tile background + text (quick stats, hero metrics). */
  readonly tile: string;
  /** Focus-ring glow for the current stepper node. */
  readonly ring: string;
}

export const LIFECYCLE_STYLES: Record<ShipLifecycleStage, LifecycleStyle> = {
  design: {
    icon: PenTool,
    badge: "bg-accent-design/10 text-accent-design",
    dot: "bg-accent-design",
    tile: "bg-accent-design/10 text-accent-design",
    ring: "ring-accent-design/25",
  },
  building: {
    icon: Hammer,
    badge: "bg-warning/10 text-warning",
    dot: "bg-warning",
    tile: "bg-warning/10 text-warning",
    ring: "ring-warning/25",
  },
  sea_trial: {
    icon: Sparkles,
    badge: "bg-info/10 text-info",
    dot: "bg-info",
    tile: "bg-info/10 text-info",
    ring: "ring-info/25",
  },
  in_service: {
    icon: Anchor,
    badge: "bg-success/10 text-success",
    dot: "bg-success",
    tile: "bg-success/10 text-success",
    ring: "ring-success/25",
  },
  maintenance: {
    icon: Wrench,
    badge: "bg-accent-maint/10 text-accent-maint",
    dot: "bg-accent-maint",
    tile: "bg-accent-maint/10 text-accent-maint",
    ring: "ring-accent-maint/25",
  },
  decommissioned: {
    icon: CircleSlash,
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    tile: "bg-muted text-muted-foreground",
    ring: "ring-muted-foreground/25",
  },
};

/** Ship status chip colors (active vessel vs archived record). */
export const SHIP_STATUS_BADGE: Record<ShipStatus, string> = RECORD_STATUS_BADGE;
