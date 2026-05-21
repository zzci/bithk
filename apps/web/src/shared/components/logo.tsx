import { Anchor } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface LogoProps {
  className?: string;
}

/** Anchor brand mark. Replace this component to rebrand. */
export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-xl bg-indigo-600 text-white",
        className,
      )}
      aria-hidden="true"
    >
      <Anchor className="size-[58%]" strokeWidth={2.5} />
    </span>
  );
}
