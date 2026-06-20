// Shared procurement create / edit form, rendered inside the global
// ResizableDrawer. One component drives both modes:
//   - create: full field set (item details + workflow), used by the list tab.
//   - edit:   item-detail fields only, used by the detail panel — workflow
//             fields (status / priority / assignee / due date / tags /
//             description) stay inline in the view, mirroring the issue panel.
// Item details freeze once a procurement is confirmed, so edit mode is only
// reachable while the procurement is still editable (the caller gates it).

import type {
  ProcurementFormMode,
  ProcurementFormValues,
} from "./-project-procurement-form-logic";
import type { ProcurementPriority, ProcurementStatus } from "@/shared/lib/api/procurement";
import type { ProjectMemberView } from "@/shared/lib/api/projects";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { MoneyInput } from "@/shared/components/money-input";
import { TagInput } from "@/shared/components/tags";
import { Button } from "@/shared/components/ui/button";
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
  PROCUREMENT_PRIORITIES,
  PROCUREMENT_STATUSES,
} from "@/shared/lib/api/procurement";
import { PROCUREMENT_FORM_NONE as NONE } from "./-project-procurement-form-logic";

interface ProcurementFormProps {
  readonly mode: ProcurementFormMode;
  /** Seed values; the form state is initialized from this once on mount. */
  readonly initial: ProcurementFormValues;
  readonly members: readonly ProjectMemberView[];
  readonly memberLabels: ReadonlyMap<string, string>;
  readonly suppliers: readonly { readonly id: string; readonly name: string }[];
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly tagSuggestions: readonly string[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: ProcurementFormValues) => void;
  readonly onCancel: () => void;
}

export function ProcurementForm({
  mode,
  initial,
  members,
  memberLabels,
  suppliers,
  categories,
  tagSuggestions,
  pending,
  error,
  onSubmit,
  onCancel,
}: ProcurementFormProps) {
  const { t } = useTranslation(["projects", "common"]);
  // Seeded once on mount; the form is remounted on every entry into create /
  // edit, so a background row refetch never clobbers in-progress input.
  const [form, setForm] = useState<ProcurementFormValues>(initial);

  const set = <K extends keyof ProcurementFormValues>(key: K, value: ProcurementFormValues[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.itemName.trim() || pending)
      return;
    onSubmit(form);
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col bg-background outline-none">
      <DetailPanelHeader
        variant="drawer"
        title={mode === "create" ? t("procurement.createTitle") : t("procurement.detail.editTitle")}
        labels={{ close: t("common:common.close") }}
        onClose={onCancel}
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {error && <ErrorBanner message={error} />}

        <div className="space-y-1.5">
          <Label htmlFor="proc-item">{t("procurement.field.itemName")}</Label>
          <Input id="proc-item" autoFocus required value={form.itemName} onChange={e => set("itemName", e.target.value)} maxLength={500} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="proc-title">{t("procurement.field.title")}</Label>
          <Input id="proc-title" value={form.title} onChange={e => set("title", e.target.value)} maxLength={500} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="proc-qty">{t("procurement.field.quantity")}</Label>
            <Input id="proc-qty" type="number" min="0" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proc-amount">{t("procurement.field.amount")}</Label>
            <MoneyInput id="proc-amount" value={form.amount} onChange={v => set("amount", v)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proc-currency">{t("procurement.field.currency")}</Label>
            <Input id="proc-currency" value={form.currency} onChange={e => set("currency", e.target.value)} maxLength={10} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("procurement.field.category")}</Label>
            <Select value={form.categoryId} onValueChange={v => v !== null && set("categoryId", v)}>
              <SelectTrigger className="w-full" aria-label={t("procurement.field.category")}>
                <SelectValue>
                  {(v: string) => (v === NONE ? t("procurement.none") : categories.find(c => c.id === v)?.name ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("procurement.none")}</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("procurement.field.supplier")}</Label>
            <Select value={form.supplierId} onValueChange={v => v !== null && set("supplierId", v)}>
              <SelectTrigger className="w-full" aria-label={t("procurement.field.supplier")}>
                <SelectValue>
                  {(v: string) => (v === NONE ? t("procurement.none") : suppliers.find(s => s.id === v)?.name ?? v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("procurement.none")}</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {mode === "create" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>{t("procurement.field.status")}</Label>
                <Select value={form.status} onValueChange={v => v !== null && set("status", v as ProcurementStatus)}>
                  <SelectTrigger className="w-full" aria-label={t("procurement.field.status")}>
                    <SelectValue>
                      {(v: string) => t(`procurement.status.${v}` as const)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PROCUREMENT_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{t(`procurement.status.${s}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("procurement.field.priority")}</Label>
                <Select value={form.priority} onValueChange={v => v !== null && set("priority", v as ProcurementPriority)}>
                  <SelectTrigger className="w-full" aria-label={t("procurement.field.priority")}>
                    <SelectValue>
                      {(v: string) => t(`procurement.priority.${v}` as const)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PROCUREMENT_PRIORITIES.map(p => (
                      <SelectItem key={p} value={p}>{t(`procurement.priority.${p}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proc-due">{t("procurement.field.dueDate")}</Label>
                <Input id="proc-due" type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("procurement.field.assignee")}</Label>
              <Select value={form.assigneeMemberId} onValueChange={v => v !== null && set("assigneeMemberId", v)}>
                <SelectTrigger className="w-full" aria-label={t("procurement.field.assignee")}>
                  <SelectValue>
                    {(v: string) => (v === NONE ? t("procurement.none") : memberLabels.get(v) ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("procurement.none")}</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>{memberLabels.get(m.id) ?? m.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-description">{t("procurement.field.description")}</Label>
              <Textarea
                id="proc-description"
                rows={4}
                value={form.description}
                onChange={e => set("description", e.target.value)}
                placeholder={t("procurement.detail.descriptionPlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("procurement.field.tags")}</Label>
              <TagInput value={form.tags} onChange={next => set("tags", next)} suggestions={tagSuggestions} />
            </div>
          </>
        )}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-5 py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !form.itemName.trim()}>
          {t("common:common.save")}
        </Button>
      </footer>
    </form>
  );
}
