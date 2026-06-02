// Shared description-editor block for the issue and procurement detail panels.
// Renders a `bg-muted/40` card that switches between an inline MarkdownEditor
// (edit), a read-only render (when a description exists), and a dashed
// "add description" affordance / muted placeholder (when empty). The owning
// panel keeps the draft + editing state and supplies the localized labels, so
// behavior is identical to the previous per-panel copies.

import { MarkdownEditor } from "@/shared/components/editor";
import { Button } from "@/shared/components/ui/button";

interface DetailDescriptionProps {
  readonly canEdit: boolean;
  readonly editing: boolean;
  /** Current saved description (read views render straight from this). */
  readonly value: string | null;
  /** Draft text while editing. */
  readonly draft: string;
  readonly placeholder: string;
  readonly noDescriptionLabel: string;
  readonly saveLabel: string;
  readonly cancelLabel: string;
  readonly onDraftChange: (value: string) => void;
  readonly onStartEdit: () => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}

export function DetailDescription({
  canEdit,
  editing,
  value,
  draft,
  placeholder,
  noDescriptionLabel,
  saveLabel,
  cancelLabel,
  onDraftChange,
  onStartEdit,
  onSave,
  onCancel,
}: DetailDescriptionProps) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      {editing && canEdit
        ? (
            <div key="description-edit" className="space-y-2">
              <MarkdownEditor
                value={draft}
                onChange={onDraftChange}
                placeholder={placeholder}
                minHeight={160}
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={onCancel}>
                  {cancelLabel}
                </Button>
                <Button onClick={onSave}>
                  {saveLabel}
                </Button>
              </div>
            </div>
          )
        : value
          ? (
              <div key="description-readonly" className="text-sm leading-relaxed">
                <MarkdownEditor value={value} readOnly />
              </div>
            )
          : canEdit
            ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onStartEdit}
                  className="h-auto w-full justify-start whitespace-normal rounded-md border border-dashed border-current bg-transparent px-2 py-1 text-left text-sm font-normal italic text-muted-foreground leading-snug transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  {noDescriptionLabel}
                </Button>
              )
            : (
                <p className="text-sm italic text-muted-foreground leading-snug">
                  {noDescriptionLabel}
                </p>
              )}
    </div>
  );
}
