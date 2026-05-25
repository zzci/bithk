import type { ContactFormState } from "./-contact-form-logic";
import type { ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
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
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  addTag,
  CONTACT_STATUSES,
  CONTACT_VISIBILITIES,
  contactFormFromView,
  EMPTY_CONTACT_FORM,
  removeTag,
} from "./-contact-form-logic";

const TEXT_FIELDS = ["contactPerson", "phone", "email", "address", "taxId"] as const;

interface ContactFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: "create" | "edit";
  readonly initial?: ContactView | null;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit: (state: ContactFormState) => void;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  pending,
  errorMessage,
  onSubmit,
}: ContactFormDialogProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const [form, setForm] = useState<ContactFormState>(EMPTY_CONTACT_FORM);
  const [tagDraft, setTagDraft] = useState("");

  /* eslint-disable react/set-state-in-effect -- reset form state for each dialog session. */
  useEffect(() => {
    if (!open)
      return;
    setForm(initial ? contactFormFromView(initial) : EMPTY_CONTACT_FORM);
    setTagDraft("");
  }, [open, initial]);
  /* eslint-enable react/set-state-in-effect */

  const set = <K extends keyof ContactFormState>(key: K, value: ContactFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const commitTag = (raw: string) => {
    set("tags", addTag(form.tags, raw));
    setTagDraft("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || pending)
      return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("form.createTitle") : t("form.editTitle")}</DialogTitle>
            <DialogDescription>
              {mode === "create" ? t("form.createDescription") : t("form.editDescription")}
            </DialogDescription>
          </DialogHeader>

          {errorMessage && <ErrorBanner message={errorMessage} />}

          <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-sm font-medium">{t("form.sections.company")}</h3>
              <p className="text-xs text-muted-foreground">{t("form.sections.companyDescription")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-name">{t("field.name")}</Label>
              <Input
                id="contact-name"
                autoFocus
                required
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder={t("form.namePlaceholder")}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-sm font-medium">{t("form.sections.methods")}</h3>
              <p className="text-xs text-muted-foreground">{t("form.sections.methodsDescription")}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map(key => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`contact-${key}`}>{t(`field.${key}` as const)}</Label>
                  <Input
                    id={`contact-${key}`}
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-note">{t("field.note")}</Label>
              <Textarea
                id="contact-note"
                value={form.note}
                onChange={e => set("note", e.target.value)}
                rows={3}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div>
              <h3 className="text-sm font-medium">{t("form.sections.access")}</h3>
              <p className="text-xs text-muted-foreground">{t("form.sections.accessDescription")}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>{t("field.status")}</Label>
                <Select value={form.status} onValueChange={v => v !== null && set("status", v as ContactStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`status.${v}` as const)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map(status => (
                      <SelectItem key={status} value={status}>{t(`status.${status}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t("field.visibility")}</Label>
                <Select value={form.visibility} onValueChange={v => v !== null && set("visibility", v as ContactVisibility)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => t(`visibility.${v}` as const)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_VISIBILITIES.map(visibility => (
                      <SelectItem key={visibility} value={visibility}>{t(`visibility.${visibility}` as const)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t("field.tags")}</Label>
              {form.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                      {tag}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("tags.remove", { name: tag })}
                        onClick={() => set("tags", removeTag(form.tags, tag))}
                        className="ml-0.5 rounded-sm hover:text-destructive"
                      >
                        <X data-icon="inline" />
                      </Button>
                    </Badge>
                  ))}
                </div>
              )}
              <Input
                value={tagDraft}
                onChange={e => setTagDraft(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    commitTag(tagDraft);
                  }
                  else if (event.key === "Backspace" && tagDraft === "" && form.tags.length > 0) {
                    set("tags", removeTag(form.tags, form.tags[form.tags.length - 1]!));
                  }
                }}
                onBlur={() => {
                  if (tagDraft.trim())
                    commitTag(tagDraft);
                }}
                placeholder={t("tags.placeholder")}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="contact-confidential">{t("field.confidential")}</Label>
                <p className="text-xs text-muted-foreground">{t("form.confidentialHelp")}</p>
              </div>
              <Switch
                id="contact-confidential"
                checked={form.confidential}
                onCheckedChange={value => set("confidential", value)}
              />
            </div>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {mode === "create" ? t("form.submitCreate") : t("form.submitSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
