// Shared favorite/unfavorite ghost icon toggle (FEAT-048), mirroring
// PinToggle: aria-pressed + favorite/unfavorite aria-label + Star icon with
// the filled state signalling "favorited". Callers own the mutation + toasts.

import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

interface FavoriteToggleProps {
  readonly favorited: boolean;
  readonly pending: boolean;
  /** Called with the next favorited state; the caller wires the mutation. */
  readonly onToggle: (willFavorite: boolean) => void;
  readonly className?: string;
  /** Stop the click bubbling to a clickable row/card wrapper. */
  readonly stopPropagation?: boolean;
}

export function FavoriteToggle({ favorited, pending, onToggle, className, stopPropagation }: FavoriteToggleProps) {
  const { t } = useTranslation(["common"]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-pressed={favorited}
      aria-label={t(favorited ? "common.unfavoriteAction" : "common.favoriteAction")}
      disabled={pending}
      onClick={(event) => {
        if (stopPropagation)
          event.stopPropagation();
        onToggle(!favorited);
      }}
    >
      <Star aria-hidden="true" className={favorited ? "fill-current text-amber-500" : undefined} />
    </Button>
  );
}
