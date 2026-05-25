import type { ContactView } from "../../apps/web/src/shared/lib/api/contacts";

const now = "2026-05-25T00:00:00.000Z";

export const fixtureContacts: readonly ContactView[] = [
  {
    id: "contact-man-es",
    ownerId: "user-admin",
    name: "MAN ES Regional Office",
    contactPerson: "Morgan Park",
    phone: "+1 555 0101",
    email: "spares@example.invalid",
    address: "8 Harbor Road",
    taxId: "TAX-MAN-001",
    note: "Primary main-engine OEM supplier for refit procurement.",
    status: "active",
    visibility: "public",
    confidential: false,
    tags: [{ id: "tag-main-engine", name: "Main engine" }, { id: "tag-oem", name: "OEM" }],
    canManage: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "contact-yard-team",
    ownerId: "user-admin",
    name: "Harbor Yard Services",
    contactPerson: "Alex Stone",
    phone: "+1 555 0102",
    email: "yard@example.invalid",
    address: "Dock 4",
    taxId: null,
    note: "Subcontractor for drydock and alignment work.",
    status: "active",
    visibility: "private",
    confidential: false,
    tags: [{ id: "tag-yard", name: "Yard" }, { id: "tag-alignment", name: "Alignment" }],
    canManage: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "contact-optimarin",
    ownerId: "user-admin",
    name: "Optimarin Service Partner",
    contactPerson: "Lars Hansen",
    phone: "+47 51 96 27 50",
    email: "service@example.invalid",
    address: "Commissioning desk",
    taxId: null,
    note: "BWMS commissioning support.",
    status: "active",
    visibility: "public",
    confidential: false,
    tags: [{ id: "tag-bwms", name: "BWMS" }, { id: "tag-commissioning", name: "Commissioning" }],
    canManage: false,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "contact-general-supply",
    ownerId: "user-admin",
    name: "General Marine Supply",
    contactPerson: "Taylor Brooks",
    phone: "+1 555 0103",
    email: null,
    address: "Warehouse 12",
    taxId: null,
    note: "General consumables and stores.",
    status: "inactive",
    visibility: "public",
    confidential: false,
    tags: [{ id: "tag-consumables", name: "Consumables" }],
    canManage: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "contact-class-society",
    ownerId: "user-admin",
    name: "North Class Society",
    contactPerson: "Riley Inspector",
    phone: "+1 555 0104",
    email: "survey@example.invalid",
    address: "Survey desk",
    taxId: null,
    note: "Class survey and certificate inspection contact.",
    status: "active",
    visibility: "public",
    confidential: true,
    tags: [{ id: "tag-class", name: "Class" }, { id: "tag-survey", name: "Survey" }],
    canManage: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "contact-masked-confidential",
    ownerId: "user-other",
    name: "Confidential Hull Consultant",
    contactPerson: null,
    phone: null,
    email: null,
    address: null,
    taxId: null,
    note: null,
    status: null,
    visibility: "public",
    confidential: true,
    tags: [{ id: "tag-consultant", name: "Consultant" }],
    canManage: false,
    createdAt: now,
    updatedAt: now,
  },
] as const;

export function listFixtureContacts(params: URLSearchParams): readonly ContactView[] {
  const tag = params.get("tag");
  if (!tag)
    return fixtureContacts;
  return fixtureContacts.filter(contact => contact.tags.some(item => item.name === tag || item.id === tag));
}

export function contactsFixtureResponse(path: string, params = new URLSearchParams()): unknown | undefined {
  if (path === "/contacts")
    return { success: true, data: listFixtureContacts(params) };

  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "contacts" || !parts[1])
    return undefined;

  const contact = fixtureContacts.find(item => item.id === parts[1]);
  if (!contact)
    return undefined;

  if (parts.length === 2)
    return { success: true, data: contact };

  return undefined;
}
