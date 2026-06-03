// Read-only "first N tags + overflow" renderer. Renders each tag as a
// non-removable TagChip; when `max` is set and exceeded, the remainder
// collapses into a `+N` (or caller-supplied) overflow indicator. Returns a
// Fragment so callers control layout. Subsumes tag-badge-list.tsx.

import type { ReactNode } from "react";
import type { BadgeVariant } from "./tag-chip";

import { TagChip } from "./tag-chip";

interface TagLike {
  readonly id?: string;
  readonly name: string;
}

export interface TagChipsProps {
  readonly tags: readonly TagLike[];
  /** When set and `tags.length > max`: render the first `max`, then the overflow indicator. */
  readonly max?: number;
  readonly variant?: BadgeVariant;
  /** Applied to each chip. */
  readonly className?: string;
  readonly moreClassName?: string;
  /** Overflow indicator; defaults to a plain `+N`. */
  readonly renderMore?: (count: number) => ReactNode;
}

export function TagChips({ tags, max, variant = "secondary", className, moreClassName, renderMore }: TagChipsProps) {
  const list = max != null ? tags.slice(0, max) : tags;
  const overflow = max != null ? tags.length - max : 0;
  return (
    <>
      {list.map(tag => (
        <TagChip key={tag.id ?? tag.name} label={tag.name} variant={variant} className={className} />
      ))}
      {overflow > 0 && (
        <span className={moreClassName}>
          {renderMore ? renderMore(overflow) : `+${overflow}`}
        </span>
      )}
    </>
  );
}
