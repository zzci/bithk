import type { ContactInput, ContactKind, ContactStatus, ContactView, ContactVisibility } from "@/shared/lib/api/contacts";

// Tag list helpers live in the shared lib; re-exported so existing importers
// (and tests) of this module keep working.
export { addTag, removeTag } from "@/shared/lib/tag-utils";

export const CONTACT_KINDS: readonly ContactKind[] = ["individual", "organization"];
export const CONTACT_STATUSES: readonly ContactStatus[] = ["active", "inactive"];
export const CONTACT_VISIBILITIES: readonly ContactVisibility[] = ["private", "public"];

// Fields the backend nulls out for confidential public contacts the caller may
// not manage. When every one is null on such a read the row is "masked".
const SENSITIVE_FIELDS = ["phone", "email", "website", "position", "taxId", "address", "note", "status"] as const;

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

// Company fields seeded onto an organization created inline from a typed name
// (individual form only). Kept as strings ("" default) and only emitted when the
// form is creating a brand-new organization.
export interface OrganizationAttributesState {
  readonly website: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string;
  readonly taxId: string;
}

const EMPTY_ORGANIZATION_ATTRIBUTES: OrganizationAttributesState = {
  website: "",
  email: "",
  phone: "",
  address: "",
  taxId: "",
};

export interface ContactFormState {
  readonly kind: ContactKind;
  readonly name: string;
  // Individual-only.
  readonly position: string;
  readonly organizationId: string | null;
  readonly organizationName: string;
  // Company fields for a new inline-created organization (individual-only).
  readonly organizationAttributes: OrganizationAttributesState;
  // Shared by both kinds.
  readonly phone: string;
  readonly email: string;
  readonly website: string;
  readonly taxId: string;
  readonly address: string;
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
  organizationId: null,
  organizationName: "",
  organizationAttributes: EMPTY_ORGANIZATION_ATTRIBUTES,
  phone: "",
  email: "",
  website: "",
  taxId: "",
  address: "",
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
    organizationId: contact.organizationId,
    organizationName: contact.organizationName ?? "",
    // Company attributes only seed a freshly created organization, so editing an
    // existing contact always starts them empty.
    organizationAttributes: EMPTY_ORGANIZATION_ATTRIBUTES,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    website: contact.website ?? "",
    taxId: contact.taxId ?? "",
    address: contact.address ?? "",
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

// Collapse the org-attribute strings into the API shape, keeping only non-empty
// fields. Returns undefined when nothing was filled so the key is omitted.
function organizationAttributesToInput(
  attrs: OrganizationAttributesState,
): ContactInput["organizationAttributes"] {
  const out: Record<string, string> = {};
  for (const key of ["website", "email", "phone", "address", "taxId"] as const) {
    const value = textOrNull(attrs[key]);
    if (value)
      out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Build the API payload. The shared set (phone/email/website/taxId/address/note
// plus classification) is emitted for both kinds; only individuals carry the
// person fields (position + organization link). `kind` is included for the
// create route's discriminated union; the update route omits/ignores it.
export function contactFormToInput(state: ContactFormState): ContactInput {
  const common = {
    name: state.name.trim(),
    phone: textOrNull(state.phone),
    email: textOrNull(state.email),
    website: textOrNull(state.website),
    address: textOrNull(state.address),
    taxId: textOrNull(state.taxId),
    note: textOrNull(state.note),
    attributes: rowsToAttributes(state.attributes),
    status: state.status,
    visibility: state.visibility,
    confidential: state.confidential,
    categoryId: state.categoryId,
    tags: state.tags,
  };
  if (state.kind === "individual") {
    // Link to the picked organization, or create one on the fly from the typed
    // name. The two are mutually exclusive: an id always wins.
    const organizationName = state.organizationId ? null : textOrNull(state.organizationName);
    // Company seed fields only apply to a brand-new (unlinked) organization.
    const organizationAttributes = organizationName
      ? organizationAttributesToInput(state.organizationAttributes)
      : undefined;
    return {
      kind: "individual",
      ...common,
      position: textOrNull(state.position),
      organizationId: state.organizationId,
      organizationName,
      ...(organizationAttributes ? { organizationAttributes } : {}),
    };
  }
  return {
    kind: "organization",
    ...common,
  };
}
