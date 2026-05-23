// Create project dialog. Used by the list page. Only the name is required;
// code, description, status and tags are optional.

import type { CreateProjectInput, ProjectStatus } from "@/shared/lib/api/projects";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorBanner } from "@/shared/components/ui/error-banner";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { TagsInput } from "./-tags-input";

const STATUSES: readonly ProjectStatus[] = ["active", "archived"];

interface ProjectFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit: (values: CreateProjectInput) => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  pending,
  errorMessage,
  onSubmit,
}: ProjectFormDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [tags, setTags] = useState<readonly string[]>([]);

  /* eslint-disable react/set-state-in-effect -- reset the form fields whenever
     the dialog opens so a previous draft never leaks into a new project. */
  useEffect(() => {
    if (!open)
      return;
    setName("");
    setCode("");
    setDescription("");
    setStatus("active");
    setTags([]);
  }, [open]);
  /* eslint-enable react/set-state-in-effect */

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    const values: CreateProjectInput = {
      name: name.trim(),
      status,
      ...(code.trim() ? { code: code.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>

          {errorMessage && <ErrorBanner message={errorMessage} />}

          <div className="space-y-1.5">
            <Label htmlFor="project-name">{t("field.name")}</Label>
            <Input
              id="project-name"
              autoFocus
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("create.namePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-code">{t("field.code")}</Label>
            <Input
              id="project-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t("create.codePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">{t("field.description")}</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("create.descriptionPlaceholder")}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("field.status")}</Label>
            <Select value={status} onValueChange={v => v !== null && setStatus(v as ProjectStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => t(`status.${v}` as const)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{t(`status.${s}` as const)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("field.tags")}</Label>
            <TagsInput value={tags} onChange={setTags} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t("create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
