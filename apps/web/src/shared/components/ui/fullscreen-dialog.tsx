// Shared shell for the app's two hand-rolled fullscreen content viewers
// (`file/file-preview-dialog.tsx`, `-univer-sheet-editor-dialog.tsx`). It owns the
// behaviour both previously duplicated verbatim: the `fixed inset-0` overlay
// with click-outside dismissal, the centered dialog panel that toggles between
// windowed and edge-to-edge fullscreen, Escape-to-close, and body scroll-lock
// while open.
//
// Why a bespoke wrapper instead of the base-ui `Dialog` primitive: these two
// viewers deliberately do NOT focus-trap or `inert` the background — they host
// Univer, CodeMirror, and react-pdf, which manage their own internal focus.
// Routing them through base-ui `Dialog` would add focus containment + an
// `inert` backdrop, a real (and risky) behaviour change. This wrapper keeps the
// exact prior behaviour and only unifies the markup + the overlay opacity token.
//
// The caller owns `open`, the `fullscreen` flag (its toggle button lives in the
// caller's header beside domain-specific tools, and some layout derives from
// it), and provides the panel content via `children`.
import type { ReactNode } from "react";

import { useEffect } from "react";

import { cn } from "@/shared/lib/utils";

interface FullscreenDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fullscreen: boolean;
  // Accessible name for the dialog panel (the entry / file name).
  readonly ariaLabel: string;
  readonly children: ReactNode;
}

export function FullscreenDialog({ open, onOpenChange, fullscreen, ariaLabel, children }: FullscreenDialogProps) {
  // Esc closes the dialog; lock body scroll while open.
  useEffect(() => {
    if (!open)
      return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape")
        onOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!open)
    return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 supports-backdrop-filter:backdrop-blur-xs",
        fullscreen ? "p-0" : "p-4",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget)
          onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={fullscreen
          ? "flex h-full w-full flex-col overflow-hidden border bg-background shadow-xl"
          : "flex h-[86vh] max-h-[820px] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border bg-background shadow-xl"}
      >
        {children}
      </div>
    </div>
  );
}
