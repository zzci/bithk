import { ChevronRight } from "lucide-react";

/** One folder hop in the navigation trail. */
export interface FolderCrumb {
  readonly id: string;
  readonly name: string;
}

interface FileBreadcrumbsProps {
  readonly crumbs: readonly FolderCrumb[];
  readonly rootLabel: string;
  /** `index` is the position in `crumbs`; pass `-1` to jump back to root. */
  readonly onNavigate: (index: number) => void;
}

export function FileBreadcrumbs({ crumbs, rootLabel, onNavigate }: FileBreadcrumbsProps) {
  return (
    <nav aria-label={rootLabel} className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <button
        type="button"
        className="truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => onNavigate(-1)}
        aria-current={crumbs.length === 0 ? "page" : undefined}
      >
        {rootLabel}
      </button>
      {crumbs.map((crumb, index) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          <button
            type="button"
            className="truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            onClick={() => onNavigate(index)}
            aria-current={index === crumbs.length - 1 ? "page" : undefined}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
