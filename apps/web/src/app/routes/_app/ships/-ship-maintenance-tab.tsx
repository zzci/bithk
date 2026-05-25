import type { IssuePriority } from "@/shared/lib/api/projects";
import type { MaintenanceTemplateInput, MaintenanceTemplateView, ShipMaintenanceOrderView, ShipView } from "@/shared/lib/api/ships";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Textarea } from "@/shared/components/ui/textarea";
import { useCreateProjectIssue } from "@/shared/lib/api/projects";
import {
  shipKeys,
  useCreateShipMaintenanceTemplate,
  useDeleteShipMaintenanceTemplate,
  useGlobalMaintenanceTemplates,
  useIssueReferences,
  useShipMaintenanceOrders,
  useShipMaintenanceTemplates,
  useUpdateShipMaintenanceTemplate,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { useAuthStore } from "@/shared/stores/auth";
import { MaintenanceTemplateReference } from "./-maintenance-template-reference";

interface ShipMaintenanceTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

interface TemplateFormState {
  readonly name: string;
  readonly category: string;
  readonly checklist: string;
  readonly precautions: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: "",
  category: "",
  checklist: "",
  precautions: "",
};

const PRIORITIES: readonly IssuePriority[] = ["low", "medium", "high", "urgent"];

function formFromTemplate(template: MaintenanceTemplateView | null): TemplateFormState {
  if (!template)
    return EMPTY_TEMPLATE_FORM;
  return {
    name: template.name,
    category: template.category ?? "",
    checklist: template.checklist ?? "",
    precautions: template.precautions ?? "",
  };
}

function templatePayload(form: TemplateFormState): { name: string } & MaintenanceTemplateInput {
  const nullable = (value: string) => value.trim() ? value.trim() : null;
  return {
    name: form.name.trim(),
    category: nullable(form.category),
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

const STATUS_VARIANTS: Record<string, "default" | "outline" | "secondary"> = {
  open: "outline",
  in_progress: "default",
  done: "secondary",
  cancelled: "secondary",
};

export function ShipMaintenanceTab({ ship, canManage }: ShipMaintenanceTabProps) {
  const { t } = useTranslation(["ships", "projects", "common"]);
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore(s => s.user?.role === "admin");

  const templatesQuery = useShipMaintenanceTemplates(ship.id);
  const ordersQuery = useShipMaintenanceOrders(ship.id);
  const globalTemplatesQuery = useGlobalMaintenanceTemplates(!!isAdmin && canManage);
  const createTemplate = useCreateShipMaintenanceTemplate();
  const updateTemplate = useUpdateShipMaintenanceTemplate();
  const deleteTemplate = useDeleteShipMaintenanceTemplate();
  const createIssue = useCreateProjectIssue();

  const [templateDialog, setTemplateDialog] = useState<"create" | "edit" | null>(null);
  const [editTemplate, setEditTemplate] = useState<MaintenanceTemplateView | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<MaintenanceTemplateView | null>(null);
  const [copyGlobalId, setCopyGlobalId] = useState("");
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ShipMaintenanceOrderView | null>(null);

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const orders = ordersQuery.data ?? [];
  const templatesById = useMemo(() => new Map(templates.map(template => [template.id, template])), [templates]);

  const selectedReferencesQuery = useIssueReferences(selectedOrder?.id);
  const selectedReference = selectedOrder
    ? selectedReferencesQuery.data?.find(ref => ref.id === selectedOrder.referenceId || ref.refId === selectedOrder.templateRefId)
    : undefined;

  const openCreateTemplate = () => {
    setEditTemplate(null);
    setTemplateDialog("create");
  };

  const openEditTemplate = (template: MaintenanceTemplateView) => {
    setEditTemplate(template);
    setTemplateDialog("edit");
  };

  const closeTemplateDialog = () => setTemplateDialog(null);

  const copyFromGlobal = () => {
    if (!copyGlobalId || createTemplate.isPending)
      return;
    createTemplate.mutate(
      { shipId: ship.id, fromGlobalId: copyGlobalId },
      { onSuccess: () => setCopyGlobalId("") },
    );
  };

  const confirmDeleteTemplate = () => {
    if (!deleteTemplateTarget)
      return;
    deleteTemplate.mutate(
      { shipId: ship.id, templateId: deleteTemplateTarget.id },
      { onSuccess: () => setDeleteTemplateTarget(null) },
    );
  };

  const handleWorkOrderCreated = () => {
    setWorkOrderOpen(false);
    void queryClient.invalidateQueries({ queryKey: shipKeys.maintenanceOrders(ship.id) });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("maintenance.template.title")}</h2>
          {canManage && (
            <Button size="sm" onClick={openCreateTemplate}>
              <Plus className="mr-1 size-4" />
              {t("maintenance.template.create")}
            </Button>
          )}
        </div>

        {canManage && isAdmin && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label>{t("maintenance.template.copyFromGlobal")}</Label>
              <Select value={copyGlobalId} onValueChange={v => v !== null && setCopyGlobalId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => globalTemplatesQuery.data?.find(template => template.id === v)?.name ?? t("maintenance.template.copyPlaceholder")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(globalTemplatesQuery.data ?? []).map(template => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={copyFromGlobal} disabled={!copyGlobalId || createTemplate.isPending || globalTemplatesQuery.isLoading}>
              {t("maintenance.template.copy")}
            </Button>
          </div>
        )}

        {templatesQuery.error && <ErrorBanner message={errorMessage(templatesQuery.error, t("common:common.error.loadFailed"))} />}
        {globalTemplatesQuery.error && <ErrorBanner message={errorMessage(globalTemplatesQuery.error, t("common:common.error.loadFailed"))} />}
        {createTemplate.error && <ErrorBanner message={errorMessage(createTemplate.error, t("common:common.error.operationFailed"))} />}
        {updateTemplate.error && <ErrorBanner message={errorMessage(updateTemplate.error, t("common:common.error.saveFailed"))} />}
        {deleteTemplate.error && <ErrorBanner message={errorMessage(deleteTemplate.error, t("common:common.error.deleteFailed"))} />}

        {templatesQuery.isLoading
          ? <p className="text-sm text-muted-foreground">{t("maintenance.template.loading")}</p>
          : templates.length === 0
            ? <p className="text-sm text-muted-foreground">{t("maintenance.template.empty")}</p>
            : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {templates.map(template => (
                    <div key={template.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{template.name}</span>
                          {template.category && <Badge variant="outline" className="text-xs">{template.category}</Badge>}
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label={t("maintenance.template.edit")} onClick={() => openEditTemplate(template)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={t("maintenance.template.delete")} onClick={() => setDeleteTemplateTarget(template)}>
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {preview(template.checklist) || t("maintenance.template.noChecklist")}
                      </p>
                      {template.precautions && <p className="text-xs text-muted-foreground">{preview(template.precautions)}</p>}
                    </div>
                  ))}
                </div>
              )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("maintenance.workOrder.title")}</h2>
          {canManage && (
            <Button size="sm" onClick={() => setWorkOrderOpen(true)} disabled={!ship.baseProjectId || templates.length === 0}>
              <FileText className="mr-1 size-4" />
              {t("maintenance.workOrder.create")}
            </Button>
          )}
        </div>

        {!ship.baseProjectId && <p className="text-sm text-muted-foreground">{t("maintenance.workOrder.noBaseProject")}</p>}
        {ordersQuery.error && <ErrorBanner message={errorMessage(ordersQuery.error, t("common:common.error.loadFailed"))} />}
        {createIssue.error && <ErrorBanner message={errorMessage(createIssue.error, t("common:common.error.operationFailed"))} />}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("maintenance.workOrder.field.title")}</TableHead>
                <TableHead>{t("maintenance.workOrder.field.template")}</TableHead>
                <TableHead>{t("maintenance.workOrder.field.status")}</TableHead>
                <TableHead className="w-24">{t("maintenance.workOrder.field.detail")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersQuery.isLoading
                ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{t("maintenance.workOrder.loading")}</TableCell></TableRow>
                : orders.length === 0
                  ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">{t("maintenance.workOrder.empty")}</TableCell></TableRow>
                  : orders.map(order => (
                      <TableRow key={`${order.id}-${order.referenceId}`}>
                        <TableCell className="font-medium">{order.title}</TableCell>
                        <TableCell>{templatesById.get(order.templateRefId)?.name ?? t("maintenance.reference.missingShort")}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[order.status] ?? "outline"} className="text-xs">
                            {t(`projects:issues.status.${order.status}` as const)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(order)}>
                            {t("maintenance.workOrder.view")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
            </TableBody>
          </Table>
        </div>

        {selectedOrder && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{selectedOrder.title}</h3>
              <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>{t("common:common.close")}</Button>
            </div>
            {selectedReferencesQuery.error && <ErrorBanner message={errorMessage(selectedReferencesQuery.error, t("common:common.error.loadFailed"))} />}
            {selectedReferencesQuery.isLoading
              ? <p className="text-sm text-muted-foreground">{t("common:common.loading")}</p>
              : <MaintenanceTemplateReference template={selectedReference?.template ?? null} />}
          </div>
        )}
      </section>

      {canManage && (
        <>
          <TemplateDialog
            open={templateDialog !== null}
            mode={templateDialog ?? "create"}
            initial={editTemplate}
            pending={createTemplate.isPending || updateTemplate.isPending}
            onOpenChange={open => !open && closeTemplateDialog()}
            onSubmit={(form) => {
              if (templateDialog === "edit" && editTemplate) {
                updateTemplate.mutate(
                  { shipId: ship.id, templateId: editTemplate.id, ...templatePayload(form) },
                  { onSuccess: closeTemplateDialog },
                );
                return;
              }
              createTemplate.mutate(
                { shipId: ship.id, ...templatePayload(form) },
                { onSuccess: closeTemplateDialog },
              );
            }}
          />
          <WorkOrderDialog
            open={workOrderOpen}
            onOpenChange={setWorkOrderOpen}
            baseProjectId={ship.baseProjectId}
            templates={templates}
            pending={createIssue.isPending}
            onSubmit={(input) => {
              if (!ship.baseProjectId)
                return;
              createIssue.mutate(
                {
                  projectId: ship.baseProjectId,
                  title: input.title,
                  priority: input.priority,
                  ...(input.description ? { description: input.description } : {}),
                  references: [{ refType: "maintenance_template", refId: input.templateId }],
                },
                { onSuccess: handleWorkOrderCreated },
              );
            }}
          />
        </>
      )}

      <ConfirmDeleteDialog
        open={deleteTemplateTarget !== null}
        onOpenChange={open => !open && setDeleteTemplateTarget(null)}
        title={t("maintenance.template.deleteTitle")}
        description={t("maintenance.template.deleteConfirm", { name: deleteTemplateTarget?.name ?? "" })}
        confirmLabel={t("maintenance.template.delete")}
        pending={deleteTemplate.isPending}
        onConfirm={confirmDeleteTemplate}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial: MaintenanceTemplateView | null;
  readonly pending: boolean;
  readonly onSubmit: (form: TemplateFormState) => void;
}) {
  const { t } = useTranslation(["ships", "common"]);
  const [form, setForm] = useState(EMPTY_TEMPLATE_FORM);

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the dialog opens. */
  useEffect(() => {
    if (open)
      setForm(formFromTemplate(initial));
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

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
            <DialogTitle>{mode === "create" ? t("maintenance.template.createTitle") : t("maintenance.template.editTitle")}</DialogTitle>
            <DialogDescription>{t("maintenance.template.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="template-name">{t("maintenance.template.field.name")}</Label>
            <Input id="template-name" autoFocus required value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-category">{t("maintenance.template.field.category")}</Label>
            <Input id="template-category" value={form.category} onChange={e => set("category", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-checklist">{t("maintenance.template.field.checklist")}</Label>
            <Textarea id="template-checklist" rows={4} value={form.checklist} onChange={e => set("checklist", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-precautions">{t("maintenance.template.field.precautions")}</Label>
            <Textarea id="template-precautions" rows={3} value={form.precautions} onChange={e => set("precautions", e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {mode === "create" ? t("maintenance.template.create") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface WorkOrderForm {
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: IssuePriority;
}

function WorkOrderDialog({
  open,
  onOpenChange,
  baseProjectId,
  templates,
  pending,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly baseProjectId: string | null;
  readonly templates: readonly MaintenanceTemplateView[];
  readonly pending: boolean;
  readonly onSubmit: (form: WorkOrderForm) => void;
}) {
  const { t } = useTranslation(["ships", "projects", "common"]);
  const [form, setForm] = useState<WorkOrderForm>({ templateId: "", title: "", description: "", priority: "medium" });

  /* eslint-disable react/set-state-in-effect -- reseed the form whenever the dialog opens. */
  useEffect(() => {
    if (!open)
      return;
    const first = templates[0];
    setForm({
      templateId: first?.id ?? "",
      title: first ? t("maintenance.workOrder.defaultTitle", { name: first.name }) : "",
      description: "",
      priority: "medium",
    });
  }, [open, templates, t]);
  /* eslint-enable react/set-state-in-effect */

  const selected = templates.find(template => template.id === form.templateId);
  const set = <K extends keyof WorkOrderForm>(key: K, value: WorkOrderForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!baseProjectId || !form.templateId || !form.title.trim() || pending)
      return;
    onSubmit({ ...form, title: form.title.trim(), description: form.description.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("maintenance.workOrder.createTitle")}</DialogTitle>
            <DialogDescription>{t("maintenance.workOrder.createDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>{t("maintenance.workOrder.field.template")}</Label>
            <Select
              value={form.templateId}
              onValueChange={(v) => {
                if (v === null)
                  return;
                const template = templates.find(item => item.id === v);
                setForm(prev => ({
                  ...prev,
                  templateId: v,
                  title: prev.title.trim() ? prev.title : (template ? t("maintenance.workOrder.defaultTitle", { name: template.name }) : ""),
                }));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => templates.find(template => template.id === v)?.name ?? t("maintenance.workOrder.selectTemplate")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {templates.map(template => (
                  <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected && <MaintenanceTemplateReference template={selected} />}

          <div className="space-y-1.5">
            <Label htmlFor="work-order-title">{t("maintenance.workOrder.field.title")}</Label>
            <Input id="work-order-title" required value={form.title} onChange={e => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-order-description">{t("maintenance.workOrder.field.description")}</Label>
            <Textarea id="work-order-description" rows={3} value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("maintenance.workOrder.field.priority")}</Label>
            <Select value={form.priority} onValueChange={v => v !== null && set("priority", v as IssuePriority)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => t(`projects:issues.priority.${v}` as const)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(priority => (
                  <SelectItem key={priority} value={priority}>{t(`projects:issues.priority.${priority}` as const)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={!baseProjectId || !form.templateId || !form.title.trim() || pending}>
              {t("maintenance.workOrder.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
