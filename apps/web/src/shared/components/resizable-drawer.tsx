// Shared accessible right-side detail drawer used by the project issue and
// procurement detail routes. Built on the base-ui Dialog primitive (the same
// one behind Sheet/Dialog) so it inherits focus-trap, focus restore to the
// triggering element, background inert, Escape-to-close and scroll-lock for
// free. SheetContent itself hardcodes its width (w-3/4 / max-w-sm) and injects
// a close button, so it cannot host this resizable layout; this thin wrapper
// keeps the custom resizable width plus a drag/keyboard-operable resize handle.

import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useState } from "react";

const DEFAULT_DRAWER_WIDTH = 672;
const MIN_DRAWER_WIDTH = 360;
const MAX_DRAWER_VIEWPORT_RATIO = 0.92;
const KEYBOARD_RESIZE_STEP = 32;

function maxDrawerWidth(): number {
  if (typeof window === "undefined")
    return DEFAULT_DRAWER_WIDTH;
  return Math.max(MIN_DRAWER_WIDTH, Math.floor(window.innerWidth * MAX_DRAWER_VIEWPORT_RATIO));
}

function clampDrawerWidth(width: number): number {
  if (typeof window === "undefined")
    return width;
  return Math.min(Math.max(width, MIN_DRAWER_WIDTH), maxDrawerWidth());
}

interface ResizableDrawerProps {
  /** Accessible name for the dialog (role="dialog"). */
  ariaLabel: string;
  /** Accessible label for the resize separator. */
  resizeLabel: string;
  /** Called when the drawer requests to close (Escape, backdrop press, etc.). */
  onClose: () => void;
  children: ReactNode;
}

export function ResizableDrawer({ ariaLabel, resizeLabel, onClose, children }: ResizableDrawerProps) {
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH);
  const [maxWidth, setMaxWidth] = useState(() => maxDrawerWidth());

  useEffect(() => {
    const handleResize = () => {
      setMaxWidth(maxDrawerWidth());
      setDrawerWidth(width => clampDrawerWidth(width));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleResizeStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0)
      return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = drawerWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setDrawerWidth(clampDrawerWidth(startWidth + startX - moveEvent.clientX));
    };

    const handlePointerUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [drawerWidth]);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // The drawer is pinned to the right edge and the handle sits on its left,
    // so Arrow Left grows the panel and Arrow Right shrinks it — matching the
    // pointer drag direction.
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setDrawerWidth(width => clampDrawerWidth(width + KEYBOARD_RESIZE_STEP));
    }
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      setDrawerWidth(width => clampDrawerWidth(width - KEYBOARD_RESIZE_STEP));
    }
  }, []);

  const drawerStyle = {
    "--drawer-width": `${drawerWidth}px`,
  } as CSSProperties;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open)
          onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <Dialog.Popup
          aria-label={ariaLabel}
          className="fixed inset-y-0 right-0 z-50 w-full border-l bg-background shadow-xl outline-none sm:w-[min(var(--drawer-width),92vw)]"
          style={drawerStyle}
        >
          {/* Resize handle: a full-height grab strip pinned to the drawer's left
              edge. Sits above the panel (z-20) with a wide hit area; drag with a
              pointer or focus it and use Arrow Left/Right to resize. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabel}
            aria-valuenow={drawerWidth}
            aria-valuemin={MIN_DRAWER_WIDTH}
            aria-valuemax={maxWidth}
            tabIndex={0}
            className="group absolute inset-y-0 left-0 z-20 hidden w-2.5 cursor-col-resize touch-none items-center justify-center transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none sm:flex"
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          >
            <div className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary" />
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
