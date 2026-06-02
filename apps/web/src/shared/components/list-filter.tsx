// Generic, reusable list filter. A dimension's options split into RESIDENT
// inline toggle chips (always visible, never measured) and a non-resident
// remainder that lives behind a single "Filter" dropdown. Selected non-resident
// options trail to the right as removable × chips; resident selections convey
// their state through the highlighted toggle chip itself.
//
// Residency is DECLARATIVE (`resident` / `residentCount`) — there is no
// ResizeObserver or width measurement, so the inline chips never flicker.
//
// Each dimension is single- or multi-select via a discriminated union so its
// `value`/`onChange` stay exactly typed. State updates are immutable.

import { SlidersHorizontal, X } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  // Allows `undefined` so callers can pass a still-loading count directly.
  readonly count?: number | undefined;
}

// Declarative residency, shared by both dimension modes:
// - `resident: true` renders the WHOLE group inline as always-visible chips.
// - `residentCount: n` pins the first N options inline; the rest go in the
//   dropdown. Omit both to keep every option in the dropdown.
interface ResidencyConfig {
  readonly resident?: boolean;
  readonly residentCount?: number;
}

export type FilterDimension
  = | (ResidencyConfig & {
    readonly key: string;
    readonly label: string;
    readonly mode: "single";
    readonly options: readonly FilterOption[];
    readonly value: string | null;
    readonly onChange: (value: string | null) => void;
    // When the value equals `defaultValue` it is treated as "unset": no chip is
    // shown and removing any other selection falls back to it.
    readonly defaultValue?: string;
  })
  | (ResidencyConfig & {
    readonly key: string;
    readonly label: string;
    readonly mode: "multi";
    readonly options: readonly FilterOption[];
    readonly value: readonly string[];
    readonly onChange: (value: string[]) => void;
  });

export interface ListFilterProps {
  readonly dimensions: readonly FilterDimension[];
  readonly className?: string;
}

// Split a dimension's options into inline-resident chips and a dropdown
// remainder, per its declarative residency config.
function splitOptions(dim: FilterDimension): {
  resident: readonly FilterOption[];
  remainder: readonly FilterOption[];
} {
  if (dim.resident)
    return { resident: dim.options, remainder: [] };
  if (typeof dim.residentCount === "number") {
    return {
      resident: dim.options.slice(0, dim.residentCount),
      remainder: dim.options.slice(dim.residentCount),
    };
  }
  return { resident: [], remainder: dim.options };
}

function isChecked(dim: FilterDimension, value: string): boolean {
  return dim.mode === "single" ? dim.value === value : dim.value.includes(value);
}

// Toggle one option. Single-select clears back to its default when the active
// option is re-selected; multi-select adds/removes the value immutably.
function toggle(dim: FilterDimension, value: string, checked: boolean): void {
  if (dim.mode === "single") {
    dim.onChange(checked ? (dim.defaultValue ?? null) : value);
    return;
  }
  dim.onChange(checked ? dim.value.filter(v => v !== value) : [...dim.value, value]);
}

interface SelectedChip {
  readonly key: string;
  readonly label: string;
  readonly onRemove: () => void;
}

// Flatten the active NON-resident selections into removable chips. Resident
// selections show their state via the highlighted inline chip, so they are
// skipped here; a single-select dimension at its default value contributes
// nothing.
function selectedChips(dimensions: readonly FilterDimension[]): SelectedChip[] {
  const chips: SelectedChip[] = [];
  for (const dim of dimensions) {
    const remainder = new Set(splitOptions(dim).remainder.map(o => o.value));
    if (dim.mode === "single") {
      const v = dim.value;
      if (v == null || v === dim.defaultValue || !remainder.has(v))
        continue;
      const opt = dim.options.find(o => o.value === v);
      if (!opt)
        continue;
      chips.push({
        key: `${dim.key}:${v}`,
        label: opt.label,
        onRemove: () => dim.onChange(dim.defaultValue ?? null),
      });
    }
    else {
      for (const v of dim.value) {
        if (!remainder.has(v))
          continue;
        const opt = dim.options.find(o => o.value === v);
        if (!opt)
          continue;
        chips.push({
          key: `${dim.key}:${v}`,
          label: opt.label,
          onRemove: () => dim.onChange(dim.value.filter(x => x !== v)),
        });
      }
    }
  }
  return chips;
}

// One always-visible inline toggle chip. Highlighted (aria-pressed) when active;
// no × — the highlight conveys state, and clicking toggles the selection.
function ResidentChip({ dim, option }: { dim: FilterDimension; option: FilterOption }) {
  const active = isChecked(dim, option.value);
  return (
    <Button
      variant="outline"
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 rounded-md px-2.5 text-xs font-medium",
        active
        && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
      )}
      onClick={() => toggle(dim, option.value, active)}
    >
      {option.label}
      {option.count !== undefined && (
        <Badge
          variant="secondary"
          className={cn("ml-1 h-5 px-1.5 text-[10px]", active && "bg-primary-foreground/20 text-primary-foreground")}
        >
          {option.count}
        </Badge>
      )}
    </Button>
  );
}

export function ListFilter({ dimensions, className }: ListFilterProps) {
  const { t } = useTranslation("projects");

  const split = dimensions.map(dim => ({ dim, ...splitOptions(dim) }));
  const remainderGroups = split.filter(g => g.remainder.length > 0);
  const chips = selectedChips(dimensions);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {/* Resident inline toggle chips, in dimension order. */}
      {split.flatMap(({ dim, resident }) =>
        resident.map(option => <ResidentChip key={`${dim.key}:${option.value}`} dim={dim} option={option} />),
      )}

      {/* Single dropdown over the non-resident remainder; hidden when empty. */}
      {remainderGroups.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button
                variant="outline"
                className="shrink-0 rounded-md px-2.5 text-xs"
                aria-label={t("list.filter")}
              />
            )}
          >
            <SlidersHorizontal aria-hidden="true" />
            {t("list.filter")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {remainderGroups.map(({ dim, remainder }, index) => (
              <Fragment key={dim.key}>
                {index > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{dim.label}</DropdownMenuLabel>
                  {remainder.map((opt) => {
                    const checked = isChecked(dim, opt.value);
                    return (
                      <DropdownMenuCheckboxItem
                        key={opt.value}
                        checked={checked}
                        onCheckedChange={() => toggle(dim, opt.value, checked)}
                      >
                        <span className="flex-1">{opt.label}</span>
                        {opt.count !== undefined && (
                          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{opt.count}</Badge>
                        )}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuGroup>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Non-resident selected options as removable chips. */}
      {chips.map(chip => (
        <span
          key={chip.key}
          className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md bg-muted py-1 pr-1 pl-2.5 text-xs font-medium"
        >
          {chip.label}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("list.filterRemove", { label: chip.label })}
            onClick={chip.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
    </div>
  );
}
