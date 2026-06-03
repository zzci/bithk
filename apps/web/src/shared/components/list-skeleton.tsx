// One loading-UX convention for the list surfaces. Lists previously flashed
// muted "loading…" text or a spinner before content, causing a content shift;
// these skeletons reserve the layout while data loads. The spinner stays for
// background refetch only. Each skeleton keeps an sr-only status label so the
// loading state is still announced to assistive tech.

import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

/** Card-grid loading placeholder (projects, ships). Mirrors the 1→4 column grid. */
export function CardGridSkeleton({
  count = 8,
  label,
  className,
}: {
  readonly count?: number;
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}
    >
      {label && <span className="sr-only">{label}</span>}
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} aria-hidden="true" className="h-44 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** List-table loading placeholder (contacts, procurement, issues). */
export function ListRowsSkeleton({
  count = 6,
  label,
  bordered = false,
}: {
  readonly count?: number;
  readonly label?: string;
  readonly bordered?: boolean;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("overflow-hidden", bordered && "rounded-lg border")}
    >
      {label && <span className="sr-only">{label}</span>}
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
        >
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
