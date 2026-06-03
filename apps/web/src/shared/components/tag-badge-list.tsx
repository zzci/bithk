// Shared "first N tags + overflow" renderer. Projects, ships, and contacts all
// showed a short tag preview followed by a `+N` (or "N more") indicator with
// byte-identical slice/overflow logic; this collapses that into one helper while
// leaving each surface its own wrapper, variant, and overflow label.

import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import type { badgeVariants } from "@/shared/components/ui/badge";
import { Badge } from "@/shared/components/ui/badge";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

interface TagBadge {
  readonly id: string;
  readonly name: string;
}

interface TagBadgeListProps {
  readonly tags: readonly TagBadge[];
  /** How many tags to render before collapsing the rest into the overflow indicator. */
  readonly max: number;
  readonly badgeVariant?: BadgeVariant;
  readonly badgeClassName?: string;
  readonly moreClassName?: string;
  /** Overflow indicator; defaults to a plain `+N`. */
  readonly renderMore?: (count: number) => ReactNode;
}

export function TagBadgeList({
  tags,
  max,
  badgeVariant = "secondary",
  badgeClassName,
  moreClassName,
  renderMore,
}: TagBadgeListProps) {
  const overflow = tags.length - max;
  return (
    <>
      {tags.slice(0, max).map(tag => (
        <Badge key={tag.id} variant={badgeVariant} className={badgeClassName}>
          {tag.name}
        </Badge>
      ))}
      {overflow > 0 && (
        <span className={moreClassName}>
          {renderMore ? renderMore(overflow) : `+${overflow}`}
        </span>
      )}
    </>
  );
}
