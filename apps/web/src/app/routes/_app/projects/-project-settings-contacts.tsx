// Contacts settings section: external contacts (suppliers, clients,
// subcontractors, others) with CRUD and a type filter.

import type {
  ContactInput,
  ContactStatus,
  ContactType,
  ProjectContactView,
} from "@/shared/lib/api/projects";
import { Plus } from "lucide-react";
import { useState } from "react";
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
import {
  CONTACT_TYPES,
  useCreateProjectContact,
  useDeleteProjectContact,
  useProjectContacts,
  useUpdateProjectContact,
} from "@/shared/lib/api/projects";
import { errorMessage } from "@/shared/lib/errors";

const CONTACT_STATUSES: readonly ContactStatus[] = ["active", "inactive"];

interface ProjectSettingsContactsProps {
  readonly projectId: string;
  readonly canManage: boolean;
}

export function ProjectSettingsContacts({ projectId, canManage }: ProjectSettingsContactsProps) {
  const { t } = useTranslation(["projects", "common"]);

  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProjectContactView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectContactView | null>(null);

  const contactsQuery = useProjectContacts(
    projectId,
    typeFilter === "__all__" ? undefined : (typeFilter as ContactType),
  );
  const deleteContact = useDeleteProjectContact();

  const contacts = contactsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={typeFilter}
          onValueChange={v => v !== null && setTypeFilter(v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue>
              {(v: string) => (v === "__all__" ? t("contacts.allTypes") : t(`contacts.type.${v}` as const))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("contacts.allTypes")}</SelectItem>
            {CONTACT_TYPES.map(ct => (
              <SelectItem key={ct} value={ct}>{t(`contacts.type.${ct}` as const)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t("contacts.add")}
          </Button>
        )}
      </div>

      {contactsQuery.error && <ErrorBanner message={errorMessage(contactsQuery.error, t("common:common.error.loadFailed"))} />}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("contacts.col.name")}</TableHead>
              <TableHead>{t("contacts.col.type")}</TableHead>
              <TableHead>{t("contacts.col.contactPerson")}</TableHead>
              <TableHead>{t("contacts.col.phone")}</TableHead>
              <TableHead>{t("contacts.col.status")}</TableHead>
              {canManage && <TableHead>{t("contacts.col.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0
              ? <TableRow><TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">{t("contacts.empty")}</TableCell></TableRow>
              : contacts.map(contact => (
                  <TableRow key={contact.id}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{t(`contacts.type.${contact.type}` as const)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{contact.contactPerson ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{contact.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm">{t(`contacts.status.${contact.status}` as const)}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditTarget(contact)}>
                            {t("common:common.edit")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(contact)}>
                            {t("common:common.delete")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setDeleteTarget(null);
        }}
        title={t("contacts.delete.title")}
        description={t("contacts.delete.confirm", { name: deleteTarget?.name })}
        onConfirm={() => {
          if (deleteTarget) {
            deleteContact.mutate({ projectId, contactId: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      {canManage && (
        <>
          <ContactDialog
            projectId={projectId}
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
          {editTarget && (
            <ContactDialog
              projectId={projectId}
              mode="edit"
              contact={editTarget}
              open
              onOpenChange={open => !open && setEditTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

interface ContactDialogProps {
  readonly projectId: string;
  readonly mode: "create" | "edit";
  readonly contact?: ProjectContactView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function ContactDialog({ projectId, mode, contact, open, onOpenChange }: ContactDialogProps) {
  const { t } = useTranslation(["projects", "common"]);
  const createContact = useCreateProjectContact();
  const updateContact = useUpdateProjectContact();

  const [type, setType] = useState<ContactType>(contact?.type ?? "supplier");
  const [name, setName] = useState(contact?.name ?? "");
  const [contactPerson, setContactPerson] = useState(contact?.contactPerson ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [address, setAddress] = useState(contact?.address ?? "");
  const [taxId, setTaxId] = useState(contact?.taxId ?? "");
  const [rating, setRating] = useState(contact?.rating != null ? String(contact.rating) : "");
  const [status, setStatus] = useState<ContactStatus>(contact?.status ?? "active");
  const [note, setNote] = useState(contact?.note ?? "");

  const pending = createContact.isPending || updateContact.isPending;
  const error = createContact.error ?? updateContact.error;

  const buildInput = (): ContactInput => ({
    contactPerson: contactPerson.trim() || null,
    phone: phone.trim() || null,
    email: email.trim() || null,
    address: address.trim() || null,
    taxId: taxId.trim() || null,
    rating: rating ? Number(rating) : null,
    status,
    note: note.trim() || null,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending)
      return;
    if (mode === "create") {
      createContact.mutate({ projectId, type, name: name.trim(), ...buildInput() }, {
        onSuccess: () => onOpenChange(false),
      });
    }
    else if (contact) {
      updateContact.mutate({ projectId, contactId: contact.id, type, name: name.trim(), ...buildInput() }, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? t("contacts.createTitle") : t("contacts.editTitle")}</DialogTitle>
            <DialogDescription>{t("contacts.dialogDescription")}</DialogDescription>
          </DialogHeader>

          {error && <ErrorBanner message={errorMessage(error, t("common:common.error.operationFailed"))} />}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("contacts.field.type")}</Label>
              <Select value={type} onValueChange={v => v !== null && setType(v as ContactType)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => t(`contacts.type.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(ct => (
                    <SelectItem key={ct} value={ct}>{t(`contacts.type.${ct}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("contacts.field.status")}</Label>
              <Select value={status} onValueChange={v => v !== null && setStatus(v as ContactStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => t(`contacts.status.${v}` as const)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{t(`contacts.status.${s}` as const)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-name">{t("contacts.field.name")}</Label>
            <Input id="contact-name" autoFocus required value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-person">{t("contacts.field.contactPerson")}</Label>
              <Input id="contact-person" value={contactPerson} onChange={e => setContactPerson(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">{t("contacts.field.phone")}</Label>
              <Input id="contact-phone" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">{t("contacts.field.email")}</Label>
              <Input id="contact-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-taxid">{t("contacts.field.taxId")}</Label>
              <Input id="contact-taxid" value={taxId} onChange={e => setTaxId(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-address">{t("contacts.field.address")}</Label>
            <Input id="contact-address" value={address} onChange={e => setAddress(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-rating">{t("contacts.field.rating")}</Label>
            <Input id="contact-rating" type="number" min="0" max="5" value={rating} onChange={e => setRating(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-note">{t("contacts.field.note")}</Label>
            <Textarea id="contact-note" rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common:common.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {mode === "create" ? t("common:common.add") : t("common:common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
