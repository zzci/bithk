// Shared pin/unpin ghost icon toggle. Issue and procurement rows each kept a
// verbatim copy of this button (aria-pressed, pin/unpin aria-label, Pin/PinOff
// icons, disabled-while-pending); only the mutation + toasts differ, so callers
// own `onToggle` while the chrome lives here.

import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

interface PinToggleProps {
  readonly pinned: boolean;
  readonly pending: boolean;
  /** Called with the next pinned state; the caller wires the mutation + toasts. */
  readonly onToggle: (willPin: boolean) => void;
  readonly className?: string;
  /** Stop the click bubbling to a clickable row wrapper. */
  readonly stopPropagation?: boolean;
}

export function PinToggle({ pinned, pending, onToggle, className, stopPropagation }: PinToggleProps) {
  const { t } = useTranslation(["projects", "common"]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-pressed={pinned}
      aria-label={t(pinned ? "overview.unpinAction" : "overview.pinAction")}
      disabled={pending}
      onClick={(event) => {
        if (stopPropagation)
          event.stopPropagation();
        onToggle(!pinned);
      }}
    >
      {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
    </Button>
  );
}
