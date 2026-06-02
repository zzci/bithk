import type { ContactInput, ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";

export const CONTACT_STATUSES: readonly ContactStatus[] = ["active", "inactive"];
export const CONTACT_VISIBILITIES: readonly ContactVisibility[] = ["private", "public"];

export interface ContactFormState {
  readonly name: string;
  readonly contactPerson: string;
  readonly phone: string;
  readonly email: string;
  readonly address: string;
  readonly taxId: string;
  readonly note: string;
  readonly status: ContactStatus;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly categoryId: string | null;
  readonly tags: readonly string[];
}

export const EMPTY_CONTACT_FORM: ContactFormState = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  taxId: "",
  note: "",
  status: "active",
  visibility: "private",
  confidential: false,
  categoryId: null,
  tags: [],
};

export function contactFormFromView(contact: ContactView): ContactFormState {
  return {
    name: contact.name,
    contactPerson: contact.contactPerson ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    address: contact.address ?? "",
    taxId: contact.taxId ?? "",
    note: contact.note ?? "",
    status: contact.status ?? "active",
    visibility: contact.visibility,
    confidential: contact.confidential,
    categoryId: contact.categoryId ?? null,
    tags: contact.tags.map(tag => tag.name),
  };
}

export function addTag(list: readonly string[], raw: string): readonly string[] {
  const name = raw.trim();
  if (!name)
    return list;
  if (list.some(tag => tag.toLowerCase() === name.toLowerCase()))
    return list;
  return [...list, name];
}

export function removeTag(list: readonly string[], name: string): readonly string[] {
  return list.filter(tag => tag !== name);
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function contactFormToInput(state: ContactFormState): ContactInput {
  return {
    name: state.name.trim(),
    contactPerson: textOrNull(state.contactPerson),
    phone: textOrNull(state.phone),
    email: textOrNull(state.email),
    address: textOrNull(state.address),
    taxId: textOrNull(state.taxId),
    note: textOrNull(state.note),
    status: state.status,
    visibility: state.visibility,
    confidential: state.confidential,
    categoryId: state.categoryId,
    tags: state.tags,
  };
}
