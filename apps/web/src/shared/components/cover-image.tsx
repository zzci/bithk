// Cover image with a built-in default. Projects and ships render their cover
// here; when none is set we fall back to a kind-specific placeholder illustration
// so cards and detail headers never show an empty band. Rendered as an <img> so
// it benefits from the Card's first-child full-bleed styling.

import coverProject from "@/assets/cover-project.svg";
import coverShip from "@/assets/cover-ship.svg";
import { cn } from "@/shared/lib/utils";

const DEFAULT_COVER = { project: coverProject, ship: coverShip } as const;

interface CoverImageProps {
  readonly src: string | null | undefined;
  readonly kind: keyof typeof DEFAULT_COVER;
  readonly className?: string;
}

export function CoverImage({ src, kind, className }: CoverImageProps) {
  return <img src={src || DEFAULT_COVER[kind]} alt="" className={cn("object-cover", className)} />;
}
