// The shared tag chip primitive. A single styled pill (optionally with a
// trailing × remove button) reused by TagChips (read-only lists), TagInput
// (selected values), and filter chips so every tag looks identical regardless
// of surface. This is the exact chip+× pattern previously inlined in
// tags-combobox.tsx.

import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/shared/components/ui/badge";

import { X } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

export interface TagChipProps {
  readonly label: string;
  readonly removable?: boolean;
  readonly onRemove?: () => void;
  /** Accessible name for the × button; required when `removable`. */
  readonly removeLabel?: string;
  readonly variant?: BadgeVariant;
  readonly className?: string | undefined;
}

export function TagChip({ label, removable, onRemove, removeLabel, variant = "secondary", className }: TagChipProps) {
  return (
    <Badge variant={variant} className={cn("gap-1 text-xs font-normal", removable && "pr-1", className)}>
      {label}
      {removable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={removeLabel}
          onClick={onRemove}
          className="-mr-0.5 rounded-sm hover:text-destructive"
        >
          <X className="size-3" />
        </Button>
      )}
    </Badge>
  );
}
