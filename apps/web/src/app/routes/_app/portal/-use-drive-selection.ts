import { useCallback, useMemo, useState } from "react";

/**
 * Multi-select state for the drive file browser. Tracks a set of selected
 * entry ids with immutable updates (every mutation produces a fresh `Set`),
 * so consumers can rely on referential changes to re-render.
 */
export interface DriveSelection {
  readonly selected: ReadonlySet<string>;
  readonly count: number;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly clear: () => void;
  readonly selectAll: (ids: readonly string[]) => void;
  /** Tick or untick every id in `ids` at once (drives the header checkbox). */
  readonly setAll: (checked: boolean, ids: readonly string[]) => void;
}

export function useDriveSelection(): DriveSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id))
        next.delete(id);
      else
        next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectAll = useCallback((ids: readonly string[]) => {
    setSelected(new Set(ids));
  }, []);

  const setAll = useCallback((checked: boolean, ids: readonly string[]) => {
    setSelected(checked ? new Set(ids) : new Set());
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return useMemo(
    () => ({ selected, count: selected.size, isSelected, toggle, clear, selectAll, setAll }),
    [selected, isSelected, toggle, clear, selectAll, setAll],
  );
}
