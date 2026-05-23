// Global command palette opened from the sidebar search entry or ⌘/Ctrl+K.
// Shows quick entries (navigation shortcuts from the sidebar registry) when
// the query is empty, and permission-scoped content hits grouped by type when
// querying. Keyboard up/down moves the active row; Enter activates it.

import type { LucideIcon } from "lucide-react";
import type { SearchHit } from "@/shared/lib/api/search";
import { useNavigate } from "@tanstack/react-router";
import { Briefcase, CheckSquare, FileText, HardDrive, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { hitTarget, matchesQuery } from "@/shared/components/command-palette.logic";
import { getNavItems } from "@/shared/components/sidebar/registry";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useGlobalSearch } from "@/shared/lib/api/search";
import { useAuthStore } from "@/shared/stores/auth";

const HIT_ICON: Record<SearchHit["type"], LucideIcon> = {
  document: FileText,
  issue: CheckSquare,
  project: Briefcase,
  drive: HardDrive,
};

interface PaletteAction {
  readonly key: string;
  readonly label: string;
  readonly subtitle?: string | undefined;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

interface PaletteGroup {
  readonly key: string;
  readonly label: string;
  readonly actions: readonly PaletteAction[];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(["common"]);
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebounce(query, 200);
  const { data, isFetching } = useGlobalSearch(debounced);

  // Reset transient state whenever the palette reopens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react/set-state-in-effect -- reset on open.
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Quick entries: sidebar nav destinations, role-filtered, matched against
  // the live (un-debounced) query so navigation feels instant.
  const quickActions = useMemo<PaletteAction[]>(() => {
    const items = [...getNavItems("overview"), ...(isAdmin ? getNavItems("admin") : [])];
    const q = query.trim().toLowerCase();
    return items
      .map((item): PaletteAction => ({
        key: `nav:${item.key}`,
        label: t(item.labelKey ?? `common:nav.${item.key}`),
        icon: item.icon,
        run: () => {
          void navigate({ to: item.path });
          close();
        },
      }))
      .filter(a => matchesQuery(a.label, q));
  }, [isAdmin, query, t, navigate, close]);

  const hitActions = useCallback(
    (hits: readonly SearchHit[]): PaletteAction[] =>
      hits.map(hit => ({
        key: `${hit.type}:${hit.id}`,
        label: hit.title,
        subtitle: hit.subtitle,
        icon: HIT_ICON[hit.type],
        run: () => {
          void navigate(hitTarget(hit));
          close();
        },
      })),
    [close, navigate],
  );

  const querying = query.trim().length > 0;

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = [];
    if (quickActions.length > 0)
      out.push({ key: "quick", label: t("common:search.quickEntry"), actions: quickActions });
    if (querying && data) {
      const sections: ReadonlyArray<[string, readonly SearchHit[]]> = [
        ["documents", data.documents],
        ["issues", data.issues],
        ["projects", data.projects],
        ["drive", data.drive],
      ];
      for (const [key, hits] of sections) {
        if (hits.length > 0)
          out.push({ key, label: t(`common:search.${key}`), actions: hitActions(hits) });
      }
    }
    return out;
  }, [quickActions, querying, data, hitActions, t]);

  // Flatten for keyboard navigation; clamp the active index when the list
  // shrinks (e.g. results arrive or the query narrows).
  const flat = useMemo(() => groups.flatMap(g => g.actions), [groups]);
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- keep active row in range.
    setActiveIndex(i => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (flat.length === 0)
      return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % flat.length);
    }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + flat.length) % flat.length);
    }
    else if (e.key === "Enter") {
      e.preventDefault();
      flat[activeIndex]?.run();
    }
  }

  const empty = querying && !isFetching && data && flat.length === 0;
  let flatCursor = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("common:search.title")}</DialogTitle>
          <DialogDescription>{t("common:search.placeholder")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("common:search.placeholder")}
            className="h-9 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {empty
            ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t("common:search.noResults")}</div>
            : groups.map(group => (
                <div key={group.key} className="py-1">
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {group.label}
                  </div>
                  <ul>
                    {group.actions.map((action) => {
                      flatCursor += 1;
                      const isActive = flatCursor === activeIndex;
                      return (
                        <li key={action.key}>
                          <button
                            type="button"
                            data-active={isActive}
                            onClick={action.run}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                          >
                            <action.icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                            <span className="flex-1 truncate">{action.label}</span>
                            {action.subtitle && (
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                                {action.subtitle}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
