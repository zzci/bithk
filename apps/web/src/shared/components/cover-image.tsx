// Cover image with a built-in default. Projects and ships render their cover
// here; when none is set we fall back to a subtle, theme-aware color gradient so
// cards and detail headers show a quiet placeholder instead of an empty band.
// When `src` is present it renders as an <img> so it benefits from the Card's
// first-child full-bleed styling.

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
}

// Stable string hash mapped onto the hue circle (0-359).
function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++)
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function CoverImage({ src, kind, className, seed }: CoverImageProps) {
  if (src)
    return <img data-slot="card-media" src={src} alt="" className={cn("object-cover", className)} />;

  const hue = seed ? hueFromSeed(seed) : NEUTRAL_HUE[kind];
  // Low-alpha gradient layered over the theme-aware `bg-muted` base: the muted
  // token keeps it calm in both themes while the hue adds quiet variety.
  const backgroundImage = `linear-gradient(135deg, hsl(${hue} 45% 55% / 0.10), hsl(${(hue + 40) % 360} 45% 55% / 0.18))`;

  return <div data-slot="card-media" aria-hidden="true" className={cn("bg-muted", className)} style={{ backgroundImage }} />;
}
