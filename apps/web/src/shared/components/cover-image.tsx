// Cover image with a built-in default. Projects and ships render their cover
// here; when none is set we fall back to a subtle, theme-aware color gradient so
// cards and detail headers show a quiet placeholder instead of an empty band.
// When `src` is present it renders as an <img> so it benefits from the Card's
// first-child full-bleed styling. With `enableLightbox` the cover becomes a
// click-to-enlarge trigger that opens a centered modal preview (opt-in).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";

type CoverKind = "project" | "ship";

// Neutral, low-saturation base hue per kind. Used when no seed is provided so the
// placeholder stays calm and consistent across both light and dark themes.
const NEUTRAL_HUE: Record<CoverKind, number> = { project: 220, ship: 200 };

interface CoverImageProps {
  readonly src: string | null | undefined;
  readonly kind: CoverKind;
  readonly className?: string;
  // Optional. When provided, the gradient hue is derived deterministically from
  // the seed (same seed -> same gradient, variety across seeds). When absent, a
  // neutral kind-based hue is used.
  readonly seed?: string;
  // Opt-in click-to-enlarge. When true (and a real image is present), the cover
  // renders as a button that opens a modal preview; defaults to false so the
  // form/admin consumers keep rendering a plain, non-interactive <img>.
  readonly enableLightbox?: boolean;
}

// Stable string hash mapped onto the hue circle (0-359).
function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function CoverImage({ src, kind, className, seed, enableLightbox = false }: CoverImageProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);

  // A fresh `src` must not inherit the previous image's failed state.
  useEffect(() => setErrored(false), [src]);

  if (!src) {
    const hue = seed ? hueFromSeed(seed) : NEUTRAL_HUE[kind];
    // Low-alpha gradient layered over the theme-aware `bg-muted` base: the muted
    // token keeps it calm in both themes while the hue adds quiet variety.
    const backgroundImage = `linear-gradient(135deg, hsl(${hue} 45% 55% / 0.10), hsl(${(hue + 40) % 360} 45% 55% / 0.18))`;
    return <div data-slot="card-media" aria-hidden="true" className={cn("bg-muted", className)} style={{ backgroundImage }} />;
  }

  // No lightbox, or a load failure fell back to a non-interactive image.
  if (!enableLightbox || errored)
    return <img data-slot="card-media" src={src} alt="" onError={() => setErrored(true)} className={cn("object-cover", className)} />;

  return (
    <>
      <button
        type="button"
        data-slot="card-media"
        aria-label={t("common.coverImage.viewLarger")}
        // `relative z-10` raises the trigger above the project card's stretched
        // `after:inset-0` link overlay so the click reaches this button.
        className={cn("relative z-10 block cursor-zoom-in overflow-hidden", className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // Stop the card's Enter/Space navigation; let the native button fire
          // its own click. Do not preventDefault.
          if (e.key === "Enter" || e.key === " ")
            e.stopPropagation();
        }}
      >
        <img src={src} alt="" onError={() => setErrored(true)} className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton className="max-w-[90vw] border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-[90vw]">
          <DialogTitle className="sr-only">{t("common.coverImage.preview")}</DialogTitle>
          <img src={src} alt={t("common.coverImage.preview")} className="mx-auto max-h-[90vh] max-w-[90vw] object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
