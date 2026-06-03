// Generic, reusable list filter rendered as a Google-Drive-style bar: EACH
// dimension is its own independent dropdown (状态 ▾ / 优先级 ▾ / 类别 ▾ …).
//
// - Unselected single dimension: a neutral outline trigger showing its label.
// - Selected single dimension: the trigger highlights and shows the chosen
//   value, with a connected × button that resets it to `defaultValue`.
// - Multi dimension: the trigger keeps its label (so more values can be added);
//   each selected value trails as its own highlighted, removable chip.
// - A trailing "Clear filters" button appears whenever any dimension is active
//   and resets every dimension at once.
//
// Each dimension is single- or multi-select via a discriminated union so its
// `value`/`onChange` stay exactly typed. State updates are immutable.

import type { ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  // Allows `undefined` so callers can pass a still-loading count directly.
  readonly count?: number | undefined;
  // Optional leading icon (e.g. drive file-type glyphs).
  readonly icon?: ReactNode;
}

export type FilterDimension
  = | {
    readonly key: string;
    readonly label: string;
    readonly mode: "single";
    readonly options: readonly FilterOption[];
    readonly value: string | null;
    readonly onChange: (value: string | null) => void;
    // The "unset" value: shows no chip, and is the × / clear-all target.
    readonly defaultValue?: string;
  }
  | {
    readonly key: string;
    readonly label: string;
    readonly mode: "multi";
    readonly options: readonly FilterOption[];
    readonly value: readonly string[];
    readonly onChange: (value: string[]) => void;
  };

export interface ListFilterProps {
  readonly dimensions: readonly FilterDimension[];
  readonly className?: string;
}

// A single-select dimension is "active" when it holds a concrete, non-default
// value. Multi is active when it has any selection.
function isActive(dim: FilterDimension): boolean {
  return dim.mode === "single"
    ? dim.value != null && dim.value !== dim.defaultValue
    : dim.value.length > 0;
}

function reset(dim: FilterDimension): void {
  if (dim.mode === "single")
    dim.onChange(dim.defaultValue ?? null);
  else
    dim.onChange([]);
}

// Highlight applied to active triggers and selected-value chips (primary tint).
const ACTIVE_CLASS
  = "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary aria-expanded:bg-primary/15 aria-expanded:text-primary";

// One single-select dimension: a dropdown trigger, plus a connected × button
// when a non-default value is selected.
function SingleControl({ dim }: { dim: Extract<FilterDimension, { mode: "single" }> }) {
  const { t } = useTranslation("projects");
  const active = isActive(dim);
  const selected = active ? dim.options.find(o => o.value === dim.value) : undefined;

  const trigger = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="outline"
            className={cn("shrink-0 whitespace-nowrap", active && `${ACTIVE_CLASS} rounded-r-none border-r-0`)}
          />
        )}
      >
        {selected?.icon}
        <span>{active ? selected?.label : dim.label}</span>
        <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {dim.options.map((opt) => {
          const checked = dim.value === opt.value;
          return (
            <DropdownMenuItem key={opt.value} className="gap-2" onClick={() => dim.onChange(opt.value)}>
              {opt.icon && <span className="flex size-4 shrink-0 items-center justify-center">{opt.icon}</span>}
              <span className="flex-1">{opt.label}</span>
              {opt.count !== undefined && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{opt.count}</Badge>
              )}
              {checked && <Check className="size-4 shrink-0" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (!active)
    return trigger;

  return (
    <span className="inline-flex shrink-0 items-center">
      {trigger}
      <Button
        variant="outline"
        size="icon"
        aria-label={t("list.filterRemove", { label: selected?.label ?? dim.label })}
        className={cn(ACTIVE_CLASS, "rounded-l-none")}
        onClick={() => dim.onChange(dim.defaultValue ?? null)}
      >
        <X aria-hidden="true" />
      </Button>
    </span>
  );
}

// One multi-select dimension trigger (the per-value chips are rendered by the
// parent so they sit right after this trigger).
function MultiTrigger({ dim }: { dim: Extract<FilterDimension, { mode: "multi" }> }) {
  const count = dim.value.length;
  const active = count > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button variant="outline" className={cn("shrink-0 whitespace-nowrap", active && ACTIVE_CLASS)} />
        )}
      >
        <span>{dim.label}</span>
        {active && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{count}</Badge>
        )}
        <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {dim.options.map((opt) => {
          const checked = dim.value.includes(opt.value);
          return (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={checked}
              onCheckedChange={() =>
                dim.onChange(checked ? dim.value.filter(v => v !== opt.value) : [...dim.value, opt.value])}
            >
              <span className="flex-1">{opt.label}</span>
              {opt.count !== undefined && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{opt.count}</Badge>
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ListFilter({ dimensions, className }: ListFilterProps) {
  const { t } = useTranslation("projects");
  const anyActive = dimensions.some(isActive);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {dimensions.map((dim) => {
        if (dim.mode === "single")
          return <SingleControl key={dim.key} dim={dim} />;
        return (
          <Fragment key={dim.key}>
            <MultiTrigger dim={dim} />
            {dim.value.map((v) => {
              const opt = dim.options.find(o => o.value === v);
              if (!opt)
                return null;
              return (
                <span
                  key={`${dim.key}:${v}`}
                  className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-md border py-1 pr-1 pl-2.5 text-xs font-medium", ACTIVE_CLASS)}
                >
                  {opt.label}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("list.filterRemove", { label: opt.label })}
                    className="text-primary hover:bg-primary/20 hover:text-primary"
                    onClick={() => dim.onChange(dim.value.filter(x => x !== v))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              );
            })}
          </Fragment>
        );
      })}

      {anyActive && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => dimensions.forEach(reset)}
        >
          {t("list.clearFilters")}
        </Button>
      )}
    </div>
  );
}
