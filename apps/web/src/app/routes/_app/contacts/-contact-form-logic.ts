import type { ContactInput, ContactKind, ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";

// Tag list helpers live in the shared lib; re-exported so existing importers
// (and tests) of this module keep working.
export { addTag, removeTag } from "@/shared/lib/tag-utils";

export const CONTACT_KINDS: readonly ContactKind[] = ["individual", "organization"];
export const CONTACT_STATUSES: readonly ContactStatus[] = ["active", "inactive"];
export const CONTACT_VISIBILITIES: readonly ContactVisibility[] = ["private", "public"];

// Fields the backend nulls out for confidential public contacts the caller may
// not manage. When every one is null on such a read the row is "masked".
const SENSITIVE_FIELDS = ["phone", "email", "position", "taxId", "address", "note", "status"] as const;

export function isMasked(contact: ContactView): boolean {
  return contact.visibility === "public"
    && contact.confidential
    && !contact.canManage
    && SENSITIVE_FIELDS.every(key => contact[key] === null);
}

// One editable custom-attribute row. The form keeps attributes as an ordered
// list of rows (so blank keys can exist mid-edit and React can key by a stable
// id) and serializes them to the flat Record the API expects on save.
export interface AttributeRow {
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

export function createAttributeRow(key = "", value = ""): AttributeRow {
  return { id: crypto.randomUUID(), key, value };
}

export interface ContactFormState {
  readonly kind: ContactKind;
  readonly name: string;
  // Individual-only.
  readonly position: string;
  readonly email: string;
  readonly organizationId: string | null;
  readonly organizationName: string;
  // Organization-only.
  readonly taxId: string;
  readonly address: string;
  // Shared by both kinds.
  readonly phone: string;
  readonly note: string;
  readonly attributes: readonly AttributeRow[];
  readonly status: ContactStatus;
  readonly visibility: ContactVisibility;
  readonly confidential: boolean;
  readonly categoryId: string | null;
  readonly tags: readonly string[];
}

export const EMPTY_CONTACT_FORM: ContactFormState = {
  kind: "individual",
  name: "",
  position: "",
  email: "",
  organizationId: null,
  organizationName: "",
  taxId: "",
  address: "",
  phone: "",
  note: "",
  attributes: [],
  status: "active",
  visibility: "private",
  confidential: false,
  categoryId: null,
  tags: [],
};

export function attributesToRows(attributes: Record<string, string> | null): readonly AttributeRow[] {
  if (!attributes)
    return [];
  return Object.entries(attributes).map(([key, value]) => createAttributeRow(key, value));
}

// Serialize editable rows back to the flat Record the API expects. Rows with a
// blank key are dropped; an empty result becomes null so the API clears the
// column rather than storing an empty object.
export function rowsToAttributes(rows: readonly AttributeRow[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key)
      out[key] = row.value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function contactFormFromView(contact: ContactView): ContactFormState {
  return {
    kind: contact.kind,
    name: contact.name,
    position: contact.position ?? "",
    email: contact.email ?? "",
    organizationId: contact.organizationId,
    organizationName: contact.organizationName ?? "",
    taxId: contact.taxId ?? "",
    address: contact.address ?? "",
    phone: contact.phone ?? "",
    note: contact.note ?? "",
    attributes: attributesToRows(contact.attributes),
    status: contact.status ?? "active",
    visibility: contact.visibility,
    confidential: contact.confidential,
    categoryId: contact.categoryId,
    tags: contact.tags.map(tag => tag.name),
  };
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

// Build the kind-appropriate API payload. `kind` is included (the create route's
// discriminated union requires it; the update route omits/ignores it). Only the
// fields valid for the kind are emitted, mirroring the backend's two body shapes.
export function contactFormToInput(state: ContactFormState): ContactInput {
  const common = {
    name: state.name.trim(),
    phone: textOrNull(state.phone),
    note: textOrNull(state.note),
    attributes: rowsToAttributes(state.attributes),
    status: state.status,
    visibility: state.visibility,
    confidential: state.confidential,
    categoryId: state.categoryId,
    tags: state.tags,
  };
  if (state.kind === "individual") {
    return {
      kind: "individual",
      ...common,
      position: textOrNull(state.position),
      email: textOrNull(state.email),
      // Link to the picked organization, or create one on the fly from the typed
      // name. The two are mutually exclusive: an id always wins.
      organizationId: state.organizationId,
      organizationName: state.organizationId ? null : textOrNull(state.organizationName),
    };
  }
  return {
    kind: "organization",
    ...common,
    taxId: textOrNull(state.taxId),
    address: textOrNull(state.address),
  };
}
