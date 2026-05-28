// Create project dialog (Linear-style). Only the name is required; the
// description and tags are optional. The project code and status are not set
// here — the backend auto-generates the code (`P-<id>`) and defaults the status
// to "active" (a freshly created project is never archived).
//
// Layout note: the dialog manages its own padding (`p-0` on the content) and
// uses a custom bordered footer rather than the shared `DialogFooter`, which
// bleeds with negative margins that assume the default `p-4` content padding.

import type { CreateProjectInput } from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { ProjectTagsCombobox } from "./-project-tags-combobox";

interface ProjectFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly availableTags?: readonly string[];
  readonly onSubmit: (values: CreateProjectInput) => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  pending,
  errorMessage,
  availableTags = [],
  onSubmit,
}: ProjectFormDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<readonly string[]>([]);

  /* eslint-disable react/set-state-in-effect -- reset the form fields whenever
     the dialog opens so a previous draft never leaks into a new project. */
  useEffect(() => {
    if (!open)
      return;
    setName("");
    setDescription("");
    setTags([]);
  }, [open]);
  /* eslint-enable react/set-state-in-effect */

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    const values: CreateProjectInput = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogTitle className="sr-only">{t("create.title")}</DialogTitle>

          <div className="space-y-2 px-5 pt-5 pb-4">
            {errorMessage && <ErrorBanner message={errorMessage} />}

            <Input
              aria-label={t("field.name")}
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
              className="h-auto border-0 bg-transparent px-0 py-0 text-lg font-semibold shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            />

            <Textarea
              aria-label={t("field.description")}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={3}
              className="min-h-16 resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            />

            <div className="pt-2">
              <ProjectTagsCombobox value={tags} onChange={setTags} suggestions={availableTags} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("create.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
