import type { ContactView } from "@/shared/lib/api/contacts";
import { describe, expect, it } from "vitest";
import {
  addTag,
  attributesToRows,
  contactFormFromView,
  contactFormToInput,
  createAttributeRow,
  EMPTY_CONTACT_FORM,
  isMasked,
  removeTag,
  rowsToAttributes,
  sensitivityOf,
  sensitivityToFields,
} from "./-contact-form-logic";

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    kind: "individual",
    ownerId: "u1",
    name: "Jane Doe",
    phone: "123",
    email: "jane@example.com",
    website: null,
    position: "Manager",
    organizationId: "org-1",
    organizationName: "Acme Marine",
    organization: null,
    taxId: null,
    address: null,
    note: "Preferred",
    attributes: { role: "lead" },
    avatarReferenceId: null,
    avatarUrl: null,
    categoryId: null,
    status: "active",
    visibility: "public",
    confidential: true,
    tags: [{ id: "t1", name: "supplier" }],
    canManage: true,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("contact form tags", () => {
  it("adds trimmed tags and ignores blanks plus case-insensitive duplicates", () => {
    expect(addTag([], " supplier ")).toEqual(["supplier"]);
    expect(addTag(["supplier"], "SUPPLIER")).toEqual(["supplier"]);
    expect(addTag(["supplier"], " ")).toEqual(["supplier"]);
  });

  it("removes the requested tag", () => {
    expect(removeTag(["keep", "drop"], "drop")).toEqual(["keep"]);
  });
});

describe("custom attribute rows", () => {
  it("round-trips a Record to rows and back, dropping blank keys", () => {
    const rows = attributesToRows({ role: "lead", region: "EU" });
    expect(rows.map(r => [r.key, r.value])).toEqual([["role", "lead"], ["region", "EU"]]);
    expect(rows.every(r => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(rowsToAttributes(rows)).toEqual({ role: "lead", region: "EU" });
  });

  it("treats null/empty attributes as no rows and serializes empties to null", () => {
    expect(attributesToRows(null)).toEqual([]);
    expect(rowsToAttributes([])).toBeNull();
    expect(rowsToAttributes([createAttributeRow("  ", "value")])).toBeNull();
  });
});

describe("contactFormFromView", () => {
  it("seeds an individual, mapping nullable fields to empty strings", () => {
    const form = contactFormFromView(contact({ phone: null }));
    expect(form.kind).toBe("individual");
    expect(form.name).toBe("Jane Doe");
    expect(form.position).toBe("Manager");
    expect(form.organizationId).toBe("org-1");
    expect(form.organizationName).toBe("Acme Marine");
    expect(form.phone).toBe("");
    expect(form.attributes.map(r => [r.key, r.value])).toEqual([["role", "lead"]]);
    expect(form.tags).toEqual(["supplier"]);
    // visibility:public + confidential:true collapses to the confidential state.
    expect(form.sensitivity).toBe("confidential");
    // Company seed fields always reset; they only apply to a new inline org.
    expect(form.organizationAttributes).toEqual({ website: "", email: "", phone: "", address: "", taxId: "" });
  });

  it("round-trips the website through the form state", () => {
    expect(contactFormFromView(contact({ website: "https://acme.test" })).website).toBe("https://acme.test");
    expect(contactFormFromView(contact({ website: null })).website).toBe("");
  });

  it("seeds an organization with its tax id and address", () => {
    const form = contactFormFromView(contact({
      kind: "organization",
      name: "Acme Yard",
      taxId: "TAX-1",
      address: "Dock 1",
      attributes: null,
    }));
    expect(form.kind).toBe("organization");
    expect(form.taxId).toBe("TAX-1");
    expect(form.address).toBe("Dock 1");
    expect(form.attributes).toEqual([]);
  });
});

describe("contactFormToInput", () => {
  it("builds an individual payload with the shared field set, creating the org from a typed name", () => {
    const out = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "individual",
      name: "  Jane Doe  ",
      position: " Manager ",
      email: " jane@example.com ",
      website: " https://jane.test ",
      taxId: " TAX-2 ",
      address: " Dock 3 ",
      phone: "",
      organizationId: null,
      organizationName: " Acme Co ",
      attributes: [createAttributeRow(" role ", "lead"), createAttributeRow("", "skip")],
      sensitivity: "confidential",
      tags: ["supplier"],
    });

    expect(out).toEqual({
      kind: "individual",
      name: "Jane Doe",
      phone: null,
      email: "jane@example.com",
      website: "https://jane.test",
      address: "Dock 3",
      taxId: "TAX-2",
      note: null,
      attributes: { role: "lead" },
      status: "active",
      // confidential collapses to private + confidential on the wire.
      visibility: "private",
      confidential: true,
      categoryId: null,
      tags: ["supplier"],
      position: "Manager",
      organizationId: null,
      organizationName: "Acme Co",
    });
  });

  it("emits organizationAttributes only when creating a new org, dropping all-empty seeds", () => {
    // New org + filled seeds -> organizationAttributes object with non-empty keys.
    const withSeeds = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "individual",
      name: "Jane",
      organizationId: null,
      organizationName: "Beta Yard",
      organizationAttributes: { website: " https://beta.test ", email: "", phone: " 555 ", address: "", taxId: "" },
    });
    expect(withSeeds.organizationAttributes).toEqual({ website: "https://beta.test", phone: "555" });

    // New org but no seeds -> key omitted entirely.
    const noSeeds = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "individual",
      name: "Jane",
      organizationId: null,
      organizationName: "Beta Yard",
    });
    expect(noSeeds).not.toHaveProperty("organizationAttributes");

    // Existing org pick -> seeds never apply even if present.
    const picked = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "individual",
      name: "Jane",
      organizationId: "org-1",
      organizationName: "Acme",
      organizationAttributes: { website: "https://acme.test", email: "", phone: "", address: "", taxId: "" },
    });
    expect(picked).not.toHaveProperty("organizationAttributes");
  });

  it("prefers a picked organization id over the name", () => {
    const out = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "individual",
      name: "Jane",
      organizationId: "org-1",
      organizationName: "Acme Marine",
    });
    expect(out.organizationId).toBe("org-1");
    expect(out.organizationName).toBeNull();
  });

  it("builds an organization payload carrying the shared field set without person-only fields", () => {
    const out = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      kind: "organization",
      name: "Acme Yard",
      taxId: "TAX-9",
      address: "Dock 7",
      email: " ops@acme.test ",
      website: " https://acme.test ",
      phone: "555",
      note: " hi ",
    });

    expect(out).toEqual({
      kind: "organization",
      name: "Acme Yard",
      phone: "555",
      email: "ops@acme.test",
      website: "https://acme.test",
      address: "Dock 7",
      taxId: "TAX-9",
      note: "hi",
      attributes: null,
      status: "active",
      visibility: "private",
      confidential: false,
      categoryId: null,
      tags: [],
    });
    expect(out).not.toHaveProperty("position");
    expect(out).not.toHaveProperty("organizationId");
  });
});

describe("sensitivity helpers", () => {
  it("collapses (visibility, confidential) into a single state, confidential winning", () => {
    expect(sensitivityOf("public", false)).toBe("public");
    expect(sensitivityOf("private", false)).toBe("private");
    expect(sensitivityOf("private", true)).toBe("confidential");
    // confidential always wins, even on a public visibility.
    expect(sensitivityOf("public", true)).toBe("confidential");
  });

  it("expands a collapsed state back to the two model fields", () => {
    expect(sensitivityToFields("public")).toEqual({ visibility: "public", confidential: false });
    expect(sensitivityToFields("private")).toEqual({ visibility: "private", confidential: false });
    expect(sensitivityToFields("confidential")).toEqual({ visibility: "private", confidential: true });
  });

  it("emits the matching {visibility, confidential} for each sensitivity via contactFormToInput", () => {
    const at = (sensitivity: "public" | "private" | "confidential") =>
      contactFormToInput({ ...EMPTY_CONTACT_FORM, kind: "organization", name: "Acme", sensitivity });
    expect(at("public")).toMatchObject({ visibility: "public", confidential: false });
    expect(at("private")).toMatchObject({ visibility: "private", confidential: false });
    expect(at("confidential")).toMatchObject({ visibility: "private", confidential: true });
  });
});

describe("isMasked", () => {
  it("is true only for confidential public reads the caller cannot manage with all sensitive fields nulled", () => {
    const masked = contact({
      canManage: false,
      visibility: "public",
      confidential: true,
      phone: null,
      email: null,
      position: null,
      taxId: null,
      address: null,
      note: null,
      status: null,
    });
    expect(isMasked(masked)).toBe(true);
    expect(isMasked(contact({ ...masked, canManage: true }))).toBe(false);
    expect(isMasked(contact({ ...masked, phone: "123" }))).toBe(false);
  });
});
