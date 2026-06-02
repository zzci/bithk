import type { ShipView } from "@/shared/lib/api/ships";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SHIP_FORM,
  isNumberFieldValid,
  parseNumberOrNull,
  shipFormFromView,
  shipFormNumberErrors,
  shipFormToCreate,
  shipFormToUpdate,
} from "./-ship-form-logic";

const CURRENT_YEAR = new Date().getUTCFullYear();

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return {
    id: "s1",
    code: "HULL-1",
    name: "Serenity",
    status: "active",
    tags: [],
    baseProjectId: "p1",
    model: "Custom 40",
    builder: "Acme Yards",
    buildYear: 2024,
    lengthOverall: 40.5,
    beam: 8,
    draft: 2.4,
    grossTonnage: 300,
    imoNumber: "IMO123",
    mmsi: "456",
    callSign: "ABCD",
    flagState: "Malta",
    registryPort: "Valletta",
    ownerName: "Jane Doe",
    description: "Flagship build",
    coverImageUrl: null,
    creatorId: "u1",
    version: 1,
    updatedAt: "2026-05-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseNumberOrNull", () => {
  it("returns null for blank or non-numeric input", () => {
    expect(parseNumberOrNull("")).toBeNull();
    expect(parseNumberOrNull("   ")).toBeNull();
    expect(parseNumberOrNull("abc")).toBeNull();
  });

  it("parses finite numbers including decimals and negatives", () => {
    expect(parseNumberOrNull("40.5")).toBe(40.5);
    expect(parseNumberOrNull(" 12 ")).toBe(12);
    expect(parseNumberOrNull("-3")).toBe(-3);
  });
});

describe("isNumberFieldValid", () => {
  it("treats blank as valid (fields are optional)", () => {
    expect(isNumberFieldValid("buildYear", "")).toBe(true);
    expect(isNumberFieldValid("lengthOverall", "  ")).toBe(true);
  });

  it("rejects non-numeric input", () => {
    expect(isNumberFieldValid("grossTonnage", "abc")).toBe(false);
  });

  it("rejects negatives and zero for strictly-positive dimensions", () => {
    expect(isNumberFieldValid("lengthOverall", "-1")).toBe(false);
    expect(isNumberFieldValid("lengthOverall", "0")).toBe(false);
    expect(isNumberFieldValid("grossTonnage", "0")).toBe(false);
    expect(isNumberFieldValid("beam", "8")).toBe(true);
  });

  it("bounds build year to a plausible window", () => {
    expect(isNumberFieldValid("buildYear", "1899")).toBe(false);
    expect(isNumberFieldValid("buildYear", "1900")).toBe(true);
    expect(isNumberFieldValid("buildYear", String(CURRENT_YEAR + 1))).toBe(true);
    expect(isNumberFieldValid("buildYear", String(CURRENT_YEAR + 2))).toBe(false);
  });

  it("rejects values above the upper bound", () => {
    expect(isNumberFieldValid("lengthOverall", "10000")).toBe(false);
    expect(isNumberFieldValid("grossTonnage", "2000000")).toBe(false);
  });
});

describe("shipFormNumberErrors", () => {
  it("is empty for a valid form", () => {
    expect(shipFormNumberErrors(EMPTY_SHIP_FORM)).toEqual([]);
    expect(shipFormNumberErrors({ ...EMPTY_SHIP_FORM, buildYear: "2024", lengthOverall: "40.5" })).toEqual([]);
  });

  it("lists each out-of-range numeric field", () => {
    const errors = shipFormNumberErrors({
      ...EMPTY_SHIP_FORM,
      buildYear: "1800",
      lengthOverall: "-5",
      grossTonnage: "0",
    });
    expect(errors).toContain("buildYear");
    expect(errors).toContain("lengthOverall");
    expect(errors).toContain("grossTonnage");
    expect(errors).not.toContain("beam");
  });
});

describe("shipFormFromView", () => {
  it("seeds every field, stringifying numbers and defaulting nulls to empty", () => {
    const form = shipFormFromView(ship({ model: null, buildYear: null }));
    expect(form.name).toBe("Serenity");
    expect(form.code).toBe("HULL-1");
    expect(form.buildYear).toBe("");
    expect(form.model).toBe("");
    expect(form.lengthOverall).toBe("40.5");
  });

  it("carries the tag names through to the form", () => {
    const form = shipFormFromView(ship({ tags: [{ id: "t1", name: "Refit" }, { id: "t2", name: "Survey" }] }));
    expect(form.tags).toEqual(["Refit", "Survey"]);
  });
});

describe("shipFormToCreate", () => {
  it("trims the name and omits a blank code (API auto-generates it)", () => {
    const out = shipFormToCreate({ ...EMPTY_SHIP_FORM, name: "  Aurora  " });
    expect(out).toEqual({ name: "Aurora", status: "active" });
    expect("code" in out).toBe(false);
  });

  it("carries selected tags and omits them when empty", () => {
    expect("tags" in shipFormToCreate({ ...EMPTY_SHIP_FORM, name: "Aurora" })).toBe(false);
    const out = shipFormToCreate({ ...EMPTY_SHIP_FORM, name: "Aurora", tags: ["Refit"] });
    expect(out.tags).toEqual(["Refit"]);
  });

  it("includes a non-blank trimmed code", () => {
    const out = shipFormToCreate({ ...EMPTY_SHIP_FORM, name: "Aurora", code: " H-9 " });
    expect(out.code).toBe("H-9");
  });
});

describe("shipFormToUpdate", () => {
  it("normalizes descriptive text to null when blank and parses numbers", () => {
    const out = shipFormToUpdate({
      ...EMPTY_SHIP_FORM,
      name: "Serenity",
      builder: "  Acme  ",
      model: "",
      buildYear: "2024",
      beam: "",
    });
    expect(out.name).toBe("Serenity");
    expect(out.builder).toBe("Acme");
    expect(out.model).toBeNull();
    expect(out.buildYear).toBe(2024);
    expect(out.beam).toBeNull();
  });

  it("omits a blank code so it is never cleared on edit", () => {
    const out = shipFormToUpdate({ ...EMPTY_SHIP_FORM, name: "Serenity", code: "" });
    expect("code" in out).toBe(false);
  });
});
