// Shared text-label dropdown filter for list toolbars (procurements, contacts).
// A radio-group dropdown with a leading "show everything" sentinel option.
// Extracted from the byte-identical ToolbarFilter copies in those two lists.

import { ChevronDown } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

// Sentinel value meaning "no filter / show everything". Callers must use this
// same string as the unfiltered value they pass in `value`.
const ALL = "__all__";

interface ToolbarFilterOption {
  readonly value: string;
  readonly label: string;
}

interface ToolbarFilterProps {
  readonly value: string;
  readonly allLabel: string;
  readonly options: readonly ToolbarFilterOption[];
  readonly onChange: (value: string) => void;
}

export function ToolbarFilter({ value, allLabel, options, onChange }: ToolbarFilterProps) {
  const current = value === ALL
    ? allLabel
    : options.find(o => o.value === value)?.label ?? allLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" className="w-44 justify-between font-normal" />}>
        <span className="truncate">{current}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={v => v !== null && onChange(v)}>
          <DropdownMenuRadioItem value={ALL}>{allLabel}</DropdownMenuRadioItem>
          {options.map(o => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
