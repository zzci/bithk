// Shared header chrome for right-side detail panels (issue / procurement, and
// any future drawer-style detail surface). Self-contained: it owns the inline
// title-edit state so callers only supply an `onSave`. Every action button is
// conditionally rendered, so a caller opts in by passing the matching handler
// (e.g. `onDelete` only for surfaces that support deletion).
//
// Presentational only: it takes already-resolved label strings (no i18n
// namespace assumptions) and renders no domain logic. The delete *confirmation*
// dialog stays in the calling panel — this only triggers `onDelete`.

import { ArrowLeft, Maximize2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";

type DetailPanelVariant = "drawer" | "fullscreen";

interface DetailPanelTitleEdit {
  /** When false the title renders read-only (no click-to-edit). */
  readonly canEdit: boolean;
  /** Commit a non-empty, changed title. Called on Enter or blur. */
  readonly onSave: (next: string) => void;
  /** Tooltip shown on the editable title (e.g. "Click to edit"). */
  readonly editHint?: string;
}

interface DetailPanelHeaderLabels {
  /** Back-to-list label, shown in the `fullscreen` variant. */
  readonly back?: string;
  readonly maximize?: string;
  readonly close?: string;
  readonly delete?: string;
}

interface DetailPanelHeaderProps {
  readonly variant: DetailPanelVariant;
  readonly title: string;
  /** Omit to render the title read-only. */
  readonly titleEdit?: DetailPanelTitleEdit;
  readonly labels?: DetailPanelHeaderLabels;
  readonly onClose: () => void;
  /** Shown (drawer only) when provided. */
  readonly onMaximize?: () => void;
  /** Delete button shown when provided. */
  readonly onDelete?: () => void;
}

export function DetailPanelHeader({
  variant,
  title,
  titleEdit,
  labels,
  onClose,
  onMaximize,
  onDelete,
}: DetailPanelHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const canEdit = titleEdit?.canEdit ?? false;

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
  };

  const save = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== title)
      titleEdit?.onSave(next);
  };

  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 shrink-0">
      {variant === "fullscreen" && (
        <Button
          variant="ghost"
          onClick={() => onClose()}
          className="-ml-1 gap-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {labels?.back}
        </Button>
      )}
      <div className="min-w-0 flex-1">
        {editing && canEdit
          ? (
              <input
                className="w-full bg-transparent text-base font-semibold tracking-tight outline-none border-b-2 border-primary"
                value={draft}
                autoFocus
                onChange={e => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                  else if (e.key === "Escape") {
                    setDraft(title);
                    setEditing(false);
                  }
                }}
              />
            )
          : (
              <h1
                className={`truncate text-base font-semibold tracking-tight ${canEdit ? "cursor-pointer rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
                onClick={() => canEdit && startEdit()}
                title={canEdit ? titleEdit?.editHint : title}
                tabIndex={canEdit ? 0 : undefined}
                onKeyDown={canEdit
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        startEdit();
                      }
                    }
                  : undefined}
              >
                {title}
              </h1>
            )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={onDelete} title={labels?.delete}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
        {variant === "drawer" && onMaximize && (
          <Button variant="ghost" size="icon" onClick={onMaximize} title={labels?.maximize}>
            <Maximize2 className="size-4" />
          </Button>
        )}
        {variant === "drawer" && (
          <Button variant="ghost" size="icon" onClick={() => onClose()} title={labels?.close}>
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
