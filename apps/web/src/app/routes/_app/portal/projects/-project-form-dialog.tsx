// Create / edit project dialog. Used by the list (create) and the detail
// header (edit). Only the name is required; all other fields are optional.

import type { CreateProjectInput, ProjectStatus, ProjectView } from "@/shared/lib/api/projects";
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

const STATUSES: readonly ProjectStatus[] = ["active", "archived", "closed"];

export interface ProjectFormValues {
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  readonly status?: ProjectStatus;
  readonly startDate?: string;
  readonly endDate?: string;
}

interface ProjectFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial?: ProjectView | null;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit: (values: CreateProjectInput) => void;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  errorMessage,
  onSubmit,
}: ProjectFormDialogProps) {
  const { t } = useTranslation("projects");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  /* eslint-disable react/set-state-in-effect -- seed form fields from the
     initial project whenever the dialog opens (create => blank, edit => row). */
  useEffect(() => {
    if (!open)
      return;
    setName(initial?.name ?? "");
    setCode(initial?.code ?? "");
    setDescription(initial?.description ?? "");
    setStatus(initial?.status ?? "active");
    setStartDate(initial?.startDate ?? "");
    setEndDate(initial?.endDate ?? "");
  }, [open, initial]);
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
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };
    onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("create.title") : t("edit.title")}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("create.description") : t("edit.description")}
            </DialogDescription>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-start">{t("field.startDate")}</Label>
              <Input
                id="project-start"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-end">{t("field.endDate")}</Label>
              <Input
                id="project-end"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {mode === "create" ? t("create.submit") : t("edit.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
