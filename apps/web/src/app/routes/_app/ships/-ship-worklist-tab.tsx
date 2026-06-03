import type { FilterDimension } from "@/shared/components/list-filter";
import type { ShipView, WorklistInput, WorklistView } from "@/shared/lib/api/ships";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListFilter } from "@/shared/components/list-filter";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { ConfirmDeleteDialog } from "@/shared/components/ui/confirm-delete-dialog";
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
import {
  useCreateShipWorklist,
  useDeleteShipWorklist,
  useGlobalWorklists,
  useShipWorklists,
  useUpdateShipWorklist,
  useWorklistTags,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { WorklistTagsCombobox } from "./-worklist-tags-combobox";

interface ShipWorklistTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

interface WorklistFormState {
  readonly name: string;
  readonly tags: readonly string[];
  readonly checklist: string;
  readonly precautions: string;
}

// Sentinel for the "blank" option of the create-dialog template selector;
// base-ui SelectItem cannot take an empty-string value.
const BLANK_TEMPLATE = "__blank__";

const EMPTY_WORKLIST_FORM: WorklistFormState = {
  name: "",
  tags: [],
  checklist: "",
  precautions: "",
};

function formFromWorklist(worklist: WorklistView | null): WorklistFormState {
  if (!worklist)
    return EMPTY_WORKLIST_FORM;
  return {
    name: worklist.name,
    tags: worklist.tags.map(tag => tag.name),
    checklist: worklist.checklist ?? "",
    precautions: worklist.precautions ?? "",
  };
}

function worklistPayload(form: WorklistFormState): { name: string } & WorklistInput {
  const nullable = (value: string) => value.trim() ? value.trim() : null;
  return {
    name: form.name.trim(),
    tags: form.tags,
    checklist: nullable(form.checklist),
    precautions: nullable(form.precautions),
  };
}

function preview(value: string | null): string {
  if (!value)
    return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed))
      return parsed.filter(item => typeof item === "string").slice(0, 2).join("; ");
  }
  catch {
    return value.replace(/\s+/g, " ").slice(0, 140);
  }
  return value.replace(/\s+/g, " ").slice(0, 140);
}

export function ShipWorklistTab({ ship, canManage }: ShipWorklistTabProps) {
  const { t } = useTranslation(["ships", "common"]);

  // Selected tag ids; empty means no tag filter. A worklist matches the union
  // of the selected tags.
  const [selectedTagIds, setSelectedTagIds] = useState<readonly string[]>([]);
  const worklistTags = useWorklistTags().data ?? [];
  const tagIds = selectedTagIds.length > 0 ? selectedTagIds : undefined;

  const worklistsQuery = useShipWorklists(ship.id, tagIds);
  const globalWorklistsQuery = useGlobalWorklists(canManage);
  const createWorklist = useCreateShipWorklist();
  const updateWorklist = useUpdateShipWorklist();
  const deleteWorklist = useDeleteShipWorklist();

  const [worklistDialog, setWorklistDialog] = useState<"create" | "edit" | null>(null);
  const [editWorklist, setEditWorklist] = useState<WorklistView | null>(null);
  const [deleteWorklistTarget, setDeleteWorklistTarget] = useState<WorklistView | null>(null);

  const worklists = useMemo(() => worklistsQuery.data ?? [], [worklistsQuery.data]);

  const tagDimension: FilterDimension = {
    key: "tags",
    label: t("worklist.tagFilter"),
    mode: "multi",
    value: selectedTagIds,
    onChange: value => setSelectedTagIds(value),
    options: worklistTags.map(tag => ({ value: tag.id, label: tag.name })),
  };

  const openCreateWorklist = () => {
    setEditWorklist(null);
    setWorklistDialog("create");
  };

  const openEditWorklist = (worklist: WorklistView) => {
    setEditWorklist(worklist);
    setWorklistDialog("edit");
  };

  const closeWorklistDialog = () => setWorklistDialog(null);

  const confirmDeleteWorklist = () => {
    if (!deleteWorklistTarget)
      return;
    deleteWorklist.mutate(
      { shipId: ship.id, worklistId: deleteWorklistTarget.id },
      { onSuccess: () => setDeleteWorklistTarget(null) },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {t("worklist.title")}
          <span className="ml-1 rounded-full bg-muted px-1.5 text-xs tabular-nums">{worklists.length}</span>
        </h2>
        {canManage && (
          <Button onClick={openCreateWorklist}>
            <Plus aria-hidden />
            {t("worklist.create")}
          </Button>
        )}
      </div>

      {/* Tag filter row, mirroring the project issues tab: a multi-select
          dropdown whose selected tags surface as removable chips; union
          semantics narrow the list to worklists carrying any selected tag.
          Omitted when no worklist tags exist yet. */}
      {worklistTags.length > 0 ? <ListFilter dimensions={[tagDimension]} /> : <div />}

      {worklistsQuery.error && <ErrorBanner message={errorMessage(worklistsQuery.error, t("common:common.error.loadFailed"))} />}
      {globalWorklistsQuery.error && <ErrorBanner message={errorMessage(globalWorklistsQuery.error, t("common:common.error.loadFailed"))} />}
      {createWorklist.error && <ErrorBanner message={errorMessage(createWorklist.error, t("common:common.error.operationFailed"))} />}
      {updateWorklist.error && <ErrorBanner message={errorMessage(updateWorklist.error, t("common:common.error.saveFailed"))} />}
      {deleteWorklist.error && <ErrorBanner message={errorMessage(deleteWorklist.error, t("common:common.error.deleteFailed"))} />}

      <section className="space-y-4">
        {worklistsQuery.isLoading
          ? <p className="text-sm text-muted-foreground">{t("worklist.loading")}</p>
          : worklists.length === 0
            ? <p className="text-sm text-muted-foreground">{t("worklist.empty")}</p>
            : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {worklists.map(worklist => (
                    <Card key={worklist.id}>
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-medium">{worklist.name}</span>
                            {worklist.tags.map(tag => (
                              <Badge key={tag.id} variant="outline" className="text-xs">{tag.name}</Badge>
                            ))}
                          </div>
                          {canManage && (
                            <div className="flex shrink-0 gap-1">
                              <Button variant="ghost" size="icon" aria-label={t("worklist.edit")} onClick={() => openEditWorklist(worklist)}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button variant="ghost" size="icon" aria-label={t("worklist.delete")} onClick={() => setDeleteWorklistTarget(worklist)}>
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2 border-t border-dashed pt-3 text-xs sm:grid-cols-2">
                          <div>
                            <p className="font-medium text-muted-foreground">{t("worklist.field.checklist")}</p>
                            <p className="mt-1 line-clamp-2 text-sm">{preview(worklist.checklist) || t("worklist.noChecklist")}</p>
                          </div>
                          <div>
                            <p className="font-medium text-muted-foreground">{t("worklist.field.precautions")}</p>
                            <p className="mt-1 line-clamp-2 text-sm">{preview(worklist.precautions) || t("overview.notSet")}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
      </section>

      {canManage && (
        <WorklistDialog
          open={worklistDialog !== null}
          mode={worklistDialog ?? "create"}
          initial={editWorklist}
          templates={globalWorklistsQuery.data ?? []}
          availableTags={worklistTags.map(tag => tag.name)}
          pending={createWorklist.isPending || updateWorklist.isPending}
          onOpenChange={open => !open && closeWorklistDialog()}
          onSubmit={(form) => {
            if (worklistDialog === "edit" && editWorklist) {
              updateWorklist.mutate(
                { shipId: ship.id, worklistId: editWorklist.id, ...worklistPayload(form) },
                { onSuccess: closeWorklistDialog },
              );
              return;
            }
            createWorklist.mutate(
              { shipId: ship.id, ...worklistPayload(form) },
              { onSuccess: closeWorklistDialog },
            );
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={deleteWorklistTarget !== null}
        onOpenChange={open => !open && setDeleteWorklistTarget(null)}
        title={t("worklist.deleteTitle")}
        description={t("worklist.deleteConfirm", { name: deleteWorklistTarget?.name ?? "" })}
        confirmLabel={t("worklist.delete")}
        pending={deleteWorklist.isPending}
        onConfirm={confirmDeleteWorklist}
      />
    </div>
  );
}

function WorklistDialog({
  open,
  onOpenChange,
  mode,
  initial,
  templates,
  availableTags,
  pending,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial: WorklistView | null;
  readonly templates: readonly WorklistView[];
  readonly availableTags: readonly string[];
  readonly pending: boolean;
  readonly onSubmit: (form: WorklistFormState) => void;
}) {
  const { t } = useTranslation(["ships", "common"]);
  const [form, setForm] = useState(EMPTY_WORKLIST_FORM);
  // Create-mode "Start from template" selection; resets to blank on open.
  const [templateId, setTemplateId] = useState(BLANK_TEMPLATE);

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the dialog opens. */
  useEffect(() => {
    if (open) {
      setForm(formFromWorklist(initial));
      setTemplateId(BLANK_TEMPLATE);
    }
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof WorklistFormState>(key: K, value: WorklistFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Prefill the whole form (incl. tags) from a chosen global template; blank
  // resets to an empty form. The user may then edit any field freely.
  const pickTemplate = (id: string) => {
    setTemplateId(id);
    if (id === BLANK_TEMPLATE) {
      setForm(EMPTY_WORKLIST_FORM);
      return;
    }
    const template = templates.find(w => w.id === id);
    if (template)
      setForm(formFromWorklist(template));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || pending)
      return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("worklist.createTitle") : t("worklist.editTitle")}</DialogTitle>
            <DialogDescription>{t("worklist.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {mode === "create" && templates.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="worklist-template">{t("worklist.startFromTemplate")}</Label>
              <Select value={templateId} onValueChange={v => v !== null && pickTemplate(v)}>
                <SelectTrigger id="worklist-template" className="w-full">
                  <SelectValue>
                    {(v: string) => v === BLANK_TEMPLATE
                      ? t("worklist.startFromTemplateBlank")
                      : templates.find(w => w.id === v)?.name ?? t("worklist.startFromTemplatePlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK_TEMPLATE}>{t("worklist.startFromTemplateBlank")}</SelectItem>
                  {templates.map(template => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="worklist-name">{t("worklist.field.name")}</Label>
            <Input id="worklist-name" autoFocus required value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("worklist.tags")}</Label>
            <WorklistTagsCombobox value={form.tags} onChange={tags => set("tags", tags)} availableTags={availableTags} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="worklist-checklist">{t("worklist.field.checklist")}</Label>
            <Textarea id="worklist-checklist" rows={4} value={form.checklist} onChange={e => set("checklist", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="worklist-precautions">{t("worklist.field.precautions")}</Label>
            <Textarea id="worklist-precautions" rows={3} value={form.precautions} onChange={e => set("precautions", e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {mode === "create" ? t("worklist.create") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
