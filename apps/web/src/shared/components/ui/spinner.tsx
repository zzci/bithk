import { Loader2 } from "lucide-react";

import { cn } from "@/shared/lib/utils";

const SPINNER_SIZE = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const;

interface SpinnerProps extends React.ComponentProps<typeof Loader2> {
  readonly size?: keyof typeof SPINNER_SIZE;
}

/**
 * Spinning `Loader2` for loading states. `aria-hidden` defaults to `true`
 * (callers add their own accessible label when the spinner is the sole
 * loading indicator).
 */
export function Spinner({ size = "sm", className, ...props }: SpinnerProps) {
  return (
    <Loader2
      aria-hidden={true}
      className={cn(SPINNER_SIZE[size], "animate-spin", className)}
      {...props}
    />
  );
}
