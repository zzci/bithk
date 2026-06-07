import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * Centers a short status string (loading / empty / error) inside the
 * available height. Defaults to muted color; `tone="destructive"` for
 * error states.
 */
export function CenteredHint({
  children,
  tone = "muted",
  className,
}: {
  readonly children: ReactNode;
  readonly tone?: "muted" | "destructive";
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center text-sm",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

const EMPTY_HINT_PADDING = {
  sm: "py-6",
  md: "py-8",
  lg: "py-10",
} as const;

/**
 * Centers a short empty / loading / no-results string with top-and-bottom
 * padding (not fill-height). Use inside list bodies where `CenteredHint`'s
 * `h-full` would collapse. Defaults to `md` padding and `muted` tone.
 */
export function EmptyHint({
  children,
  py = "md",
  tone = "muted",
  className,
}: {
  readonly children: ReactNode;
  readonly py?: "sm" | "md" | "lg";
  readonly tone?: "muted" | "destructive";
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center text-sm",
        EMPTY_HINT_PADDING[py],
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
