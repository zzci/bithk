// Create / edit form mode of the colleague panel, extracted from
// -colleague-panel.tsx: user picker, profile fields, the emergency-contact and
// payment-info repeaters, and the shared enum dropdown. Reuses the shared
// DetailPanelHeader plus the section primitives from -colleague-panel-shared.tsx.

import type { ColleagueForm } from "./-colleague-form-logic";
import type { ColleaguePanelProps } from "./-colleague-panel-shared";
import type {
  HrColleagueStatus,
  HrEmergencyContact,
  HrEmploymentType,
  HrGender,
  HrPaymentField,
} from "@/shared/lib/api/hr";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DetailPanelHeader } from "@/shared/components/detail-panel-header";
import { MoneyInput } from "@/shared/components/money-input";
import { Badge } from "@/shared/components/ui/badge";
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
import { useGlobalCurrencies, withCurrency } from "@/shared/lib/api/currency";
import {
  HR_COLLEAGUE_STATUSES,
  HR_EMPLOYMENT_TYPES,
  HR_GENDERS,
} from "@/shared/lib/api/hr";
import {
  colleagueFormFromRow,
  EMPTY_COLLEAGUE_FORM,
  EMPTY_EMERGENCY_CONTACT,
} from "./-colleague-form-logic";
import { HR_EMPLOYMENT_LABEL_KEY, HR_GENDER_LABEL_KEY } from "./-colleague-labels";
import { PanelSection } from "./-colleague-panel-shared";

// "no selection" sentinel for the enum dropdowns (Select cannot hold "").
const ENUM_NONE = "__none__";

export function ColleaguePanelForm({
  mode,
  colleague,
  users,
  pending,
  errorMessage: formError,
  onSubmit,
  onCancel,
}: ColleaguePanelProps) {
  const { t } = useTranslation(["hr", "common"]);
  const [form, setForm] = useState<ColleagueForm>(EMPTY_COLLEAGUE_FORM);

  /* eslint-disable react/set-state-in-effect -- seed the form when the drawer opens or its target/mode changes. */
  useEffect(() => {
    setForm(mode === "edit" && colleague ? colleagueFormFromRow(colleague) : EMPTY_COLLEAGUE_FORM);
  }, [mode, colleague]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ColleagueForm>(key: K, value: ColleagueForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Global currency list unioned with the record's own value (keeps a legacy
  // code selectable even if it is not in the configured list).
  const currencyOptions = withCurrency(useGlobalCurrencies(), form.salaryCurrency || null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.userId || pending)
      return;
    onSubmit(form);
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col bg-background outline-none">
      <DetailPanelHeader
        variant="drawer"
        title={mode === "create" ? t("colleagues.createTitle") : t("colleagues.editTitle")}
        labels={{ close: t("common:common.close") }}
        onClose={onCancel}
      />

      <div className="@container flex-1 space-y-7 overflow-y-auto px-5 py-5">
        {formError && <ErrorBanner message={formError} />}

        <PanelSection title={t("colleagues.section.identity")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t("colleagues.field.user")}</Label>
              <Select value={form.userId} onValueChange={v => v !== null && set("userId", v)}>
                <SelectTrigger className="w-full" aria-label={t("colleagues.field.user")}>
                  <SelectValue placeholder={t("colleagues.selectUser")}>
                    {(v: string) => {
                      const u = users.find(item => item.id === v);
                      return u ? `${u.name} (${u.username})` : v;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className="flex items-center gap-2">
                        {`${u.name} (${u.username})`}
                        {u.isVirtual && (
                          <Badge variant="outline" className="text-xs">{t("colleagues.virtualBadge")}</Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              <FieldInput id="colleague-code" label={t("colleagues.field.code")} value={form.code} onChange={v => set("code", v)} maxLength={100} />
              <FieldInput id="colleague-title" label={t("colleagues.field.title")} value={form.title} onChange={v => set("title", v)} maxLength={200} />
              <FieldInput id="colleague-department" label={t("colleagues.field.department")} value={form.department} onChange={v => set("department", v)} maxLength={200} />
              <EnumField
                label={t("colleagues.field.employmentType")}
                value={form.employmentType}
                onChange={v => set("employmentType", v as "" | HrEmploymentType)}
                options={HR_EMPLOYMENT_TYPES}
                optionLabel={v => t(HR_EMPLOYMENT_LABEL_KEY[v])}
                noneLabel={t("colleagues.unset")}
              />
            </div>
          </div>
        </PanelSection>

        <PanelSection title={t("colleagues.section.personal")}>
          <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
            <EnumField
              label={t("colleagues.field.gender")}
              value={form.gender}
              onChange={v => set("gender", v as "" | HrGender)}
              options={HR_GENDERS}
              optionLabel={v => t(HR_GENDER_LABEL_KEY[v])}
              noneLabel={t("colleagues.unset")}
            />
            <FieldInput id="colleague-birthday" type="date" label={t("colleagues.field.birthday")} value={form.birthday} onChange={v => set("birthday", v)} />
            <FieldInput id="colleague-nationality" label={t("colleagues.field.nationality")} value={form.nationality} onChange={v => set("nationality", v)} maxLength={200} />
          </div>
        </PanelSection>

        <PanelSection title={t("colleagues.section.contact")}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              <FieldInput id="colleague-phone" label={t("colleagues.field.personalPhone")} value={form.personalPhone} onChange={v => set("personalPhone", v)} maxLength={50} />
              <FieldInput id="colleague-email" type="email" label={t("colleagues.field.personalEmail")} value={form.personalEmail} onChange={v => set("personalEmail", v)} maxLength={200} />
            </div>
            <FieldInput id="colleague-address" label={t("colleagues.field.address")} value={form.address} onChange={v => set("address", v)} maxLength={500} />
          </div>
        </PanelSection>

        <PanelSection title={t("colleagues.section.emergency")}>
          <EmergencyContactsEditor
            value={form.emergencyContacts}
            onChange={rows => set("emergencyContacts", rows)}
          />
        </PanelSection>

        <PanelSection title={t("colleagues.section.employment")}>
          <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
            <FieldInput id="colleague-hireDate" type="date" label={t("colleagues.field.hireDate")} value={form.hireDate} onChange={v => set("hireDate", v)} />
            <FieldInput id="colleague-probation" type="date" label={t("colleagues.field.probationEndDate")} value={form.probationEndDate} onChange={v => set("probationEndDate", v)} />
            <FieldInput id="colleague-contractEnd" type="date" label={t("colleagues.field.contractEndDate")} value={form.contractEndDate} onChange={v => set("contractEndDate", v)} />
            <FieldInput id="colleague-workLocation" label={t("colleagues.field.workLocation")} value={form.workLocation} onChange={v => set("workLocation", v)} maxLength={200} />
          </div>
        </PanelSection>

        <PanelSection title={t("colleagues.section.salary")}>
          <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="colleague-salaryAmount">{t("colleagues.field.salaryAmount")}</Label>
              <MoneyInput
                id="colleague-salaryAmount"
                value={form.salaryAmount}
                onChange={v => set("salaryAmount", v)}
              />
            </div>
            <EnumField
              label={t("colleagues.field.salaryCurrency")}
              value={form.salaryCurrency}
              onChange={v => set("salaryCurrency", v)}
              options={currencyOptions}
              optionLabel={v => v}
              noneLabel={t("colleagues.unset")}
            />
          </div>
        </PanelSection>

        <PanelSection title={t("colleagues.section.payment")}>
          <PaymentInfoEditor value={form.paymentInfo} onChange={rows => set("paymentInfo", rows)} />
        </PanelSection>

        {mode === "edit" && (
          <PanelSection title={t("colleagues.field.status")}>
            <Select value={form.status} onValueChange={v => v !== null && set("status", v as HrColleagueStatus)}>
              <SelectTrigger className="w-full" aria-label={t("colleagues.field.status")}>
                <SelectValue>
                  {(v: HrColleagueStatus) =>
                    v === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HR_COLLEAGUE_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>
                    {s === "active" ? t("colleagues.statusActive") : t("colleagues.statusArchived")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PanelSection>
        )}

        <PanelSection title={t("colleagues.field.notes")}>
          <Textarea
            id="colleague-notes"
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            rows={3}
            maxLength={2000}
            aria-label={t("colleagues.field.notes")}
          />
        </PanelSection>
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-border/60 px-5 py-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common:common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || !form.userId}>
          {t("common:common.save")}
        </Button>
      </footer>
    </form>
  );
}

// ── Repeaters ──

function PaymentInfoEditor({
  value,
  onChange,
}: {
  readonly value: readonly HrPaymentField[];
  readonly onChange: (rows: HrPaymentField[]) => void;
}) {
  const { t } = useTranslation(["hr"]);

  const update = (idx: number, patch: Partial<HrPaymentField>) =>
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {value.map((row, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <Input
            aria-label={t("colleagues.payment.label")}
            placeholder={t("colleagues.payment.label")}
            value={row.label}
            maxLength={100}
            className="flex-1"
            onChange={e => update(idx, { label: e.target.value })}
          />
          <Input
            aria-label={t("colleagues.payment.value")}
            placeholder={t("colleagues.payment.value")}
            value={row.value}
            maxLength={500}
            className="flex-1"
            onChange={e => update(idx, { value: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("colleagues.payment.remove")}
            onClick={() => onChange(value.filter((_, i) => i !== idx))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { label: "", value: "" }])}
      >
        <Plus aria-hidden="true" />
        {t("colleagues.payment.add")}
      </Button>
    </div>
  );
}

function EmergencyContactsEditor({
  value,
  onChange,
}: {
  readonly value: readonly HrEmergencyContact[];
  readonly onChange: (rows: HrEmergencyContact[]) => void;
}) {
  const { t } = useTranslation(["hr"]);

  const update = (idx: number, patch: Partial<HrEmergencyContact>) =>
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      {value.map((row, idx) => (
        <div key={idx} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t("colleagues.emergency.entry", { index: idx + 1 })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("colleagues.emergency.remove")}
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2">
            <Input aria-label={t("colleagues.emergency.name")} placeholder={t("colleagues.emergency.name")} value={row.name} maxLength={100} onChange={e => update(idx, { name: e.target.value })} />
            <Input aria-label={t("colleagues.emergency.relation")} placeholder={t("colleagues.emergency.relation")} value={row.relation} maxLength={100} onChange={e => update(idx, { relation: e.target.value })} />
            <Input aria-label={t("colleagues.emergency.phone")} placeholder={t("colleagues.emergency.phone")} value={row.phone} maxLength={50} onChange={e => update(idx, { phone: e.target.value })} />
            <Input aria-label={t("colleagues.emergency.email")} placeholder={t("colleagues.emergency.email")} value={row.email} maxLength={200} onChange={e => update(idx, { email: e.target.value })} />
            <div className="@sm:col-span-2">
              <Input aria-label={t("colleagues.emergency.address")} placeholder={t("colleagues.emergency.address")} value={row.address} maxLength={500} onChange={e => update(idx, { address: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { ...EMPTY_EMERGENCY_CONTACT }])}
      >
        <Plus aria-hidden="true" />
        {t("colleagues.emergency.add")}
      </Button>
    </div>
  );
}

// ── Field primitives ──

function FieldInput({
  id,
  label,
  value,
  onChange,
  type,
  maxLength,
  min,
  step,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly maxLength?: number;
  readonly min?: number;
  readonly step?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        maxLength={maxLength}
        min={min}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// A nullable enum dropdown with an explicit "unset" option (maps to "").
function EnumField<T extends string>({
  label,
  value,
  onChange,
  options,
  optionLabel,
  noneLabel,
}: {
  readonly label: string;
  readonly value: "" | T;
  readonly onChange: (value: "" | T) => void;
  readonly options: readonly T[];
  readonly optionLabel: (value: T) => string;
  readonly noneLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value === "" ? ENUM_NONE : value}
        onValueChange={v => v !== null && onChange(v === ENUM_NONE ? "" : (v as T))}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue>
            {(v: string) => (v === ENUM_NONE ? noneLabel : optionLabel(v as T))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ENUM_NONE}>{noneLabel}</SelectItem>
          {options.map(opt => (
            <SelectItem key={opt} value={opt}>{optionLabel(opt)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
