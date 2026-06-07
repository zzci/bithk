// Searchable worklist picker for the create-issue dialog. Lists the project's
// referenceable worklists grouped into "本船 / 全局" (this ship / global), filters
// by name or tags, and reports the chosen worklist to the caller. Uses the
// shared shadcn Dialog + Input primitives — no extra UI deps.

import type { ReferenceableWorklist } from "@/shared/lib/api/projects";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { EmptyHint } from "@/shared/components/ui/centered-hint";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { useReferenceableWorklists } from "@/shared/lib/api/projects";

interface WorklistPickerProps {
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (worklist: ReferenceableWorklist) => void;
}

function matches(worklist: ReferenceableWorklist, query: string): boolean {
  if (!query)
    return true;
  return (
    worklist.name.toLowerCase().includes(query)
    || worklist.tags.some(tag => tag.name.toLowerCase().includes(query))
  );
}

export function WorklistPicker({ projectId, open, onOpenChange, onSelect }: WorklistPickerProps) {
  const { t } = useTranslation("projects");
  const [search, setSearch] = useState("");
  // Only fetch once the picker has been opened to avoid a request per dialog
  // mount; the result is cached so reopening is instant.
  const query = useReferenceableWorklists(open ? projectId : undefined);

  const q = search.trim().toLowerCase();
  const ship = useMemo(
    () => (query.data?.ship ?? []).filter(w => matches(w, q)),
    [query.data, q],
  );
  const global = useMemo(
    () => (query.data?.global ?? []).filter(w => matches(w, q)),
    [query.data, q],
  );

  const pick = (worklist: ReferenceableWorklist) => {
    onSelect(worklist);
    setSearch("");
  };

  const isEmpty = ship.length === 0 && global.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("issues.worklist.pickerTitle")}</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t("issues.worklist.searchPlaceholder")}
          aria-label={t("issues.worklist.searchPlaceholder")}
        />

        <div className="max-h-80 overflow-y-auto">
          {query.isLoading
            ? <EmptyHint py="sm">{t("issues.worklist.loading")}</EmptyHint>
            : isEmpty
              ? <EmptyHint py="sm">{t("issues.worklist.empty")}</EmptyHint>
              : (
                  <div className="space-y-3">
                    <WorklistGroup label={t("issues.worklist.groupShip")} items={ship} onPick={pick} />
                    <WorklistGroup label={t("issues.worklist.groupGlobal")} items={global} onPick={pick} />
                  </div>
                )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface WorklistGroupProps {
  readonly label: string;
  readonly items: readonly ReferenceableWorklist[];
  readonly onPick: (worklist: ReferenceableWorklist) => void;
}

function WorklistGroup({ label, items, onPick }: WorklistGroupProps) {
  if (items.length === 0)
    return null;
  return (
    <section aria-label={label}>
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {items.map(worklist => (
          <li key={worklist.id}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left font-normal"
              onClick={() => onPick(worklist)}
            >
              <span className="truncate text-sm">{worklist.name}</span>
              {worklist.tags.length > 0 && (
                <span className="truncate text-xs text-muted-foreground">{worklist.tags.map(tag => tag.name).join(", ")}</span>
              )}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
