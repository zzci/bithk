import type { ContactView } from "@/shared/lib/api/contacts";
import { describe, expect, it } from "vitest";
import {
  addTag,
  contactFormFromView,
  contactFormToInput,
  EMPTY_CONTACT_FORM,
  removeTag,
} from "./-contact-form-logic";

function contact(overrides: Partial<ContactView> = {}): ContactView {
  return {
    id: "c1",
    ownerId: "u1",
    name: "Acme Marine",
    contactPerson: "Jane",
    phone: "123",
    email: "jane@example.com",
    address: "Dock 1",
    taxId: "TAX-1",
    note: "Preferred",
    status: "active",
    visibility: "public",
    confidential: true,
    categoryId: null,
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

describe("contactFormFromView", () => {
  it("seeds nullable fields as empty strings and preserves tags", () => {
    const form = contactFormFromView(contact({ phone: null, note: null }));
    expect(form.name).toBe("Acme Marine");
    expect(form.phone).toBe("");
    expect(form.note).toBe("");
    expect(form.visibility).toBe("public");
    expect(form.confidential).toBe(true);
    expect(form.tags).toEqual(["supplier"]);
  });
});

describe("contactFormToInput", () => {
  it("trims name, normalizes blank optional text to null, and keeps visibility settings", () => {
    const out = contactFormToInput({
      ...EMPTY_CONTACT_FORM,
      name: "  Acme Marine  ",
      contactPerson: " Jane ",
      phone: "",
      visibility: "public",
      confidential: true,
      tags: ["supplier"],
    });

    expect(out).toEqual({
      name: "Acme Marine",
      contactPerson: "Jane",
      phone: null,
      email: null,
      address: null,
      taxId: null,
      note: null,
      status: "active",
      visibility: "public",
      confidential: true,
      categoryId: null,
      tags: ["supplier"],
    });
  });
});
