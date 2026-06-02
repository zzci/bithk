// Shared search input: a text Input with a leading magnifier icon. Controlled —
// the caller keeps the raw value state (and pairs it with the shared `useDebounce`
// hook for server-side search). Replaces the repeated icon+Input markup in the
// project / ship / contact / procurement list toolbars.

import { Search } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

interface SearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  /** Wrapper width/utility classes, e.g. "w-full sm:w-64". */
  readonly className?: string;
}

export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}
