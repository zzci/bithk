import type { ShipProfileView } from "@/shared/lib/api/project-sections";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SHIP_PROFILE_FORM,
  isNumberFieldValid,
  parseNumberOrNull,
  shipProfileFormFromView,
  shipProfileFormNumberErrors,
  shipProfileFormToUpdate,
} from "./-ship-profile-form-logic";

const CURRENT_YEAR = new Date().getUTCFullYear();

function profile(overrides: Partial<ShipProfileView> = {}): ShipProfileView {
  return {
    hullNumber: "HULL-1",
    shipStatus: "active",
    model: "Custom 40",
    builder: "Acme Yards",
    buildYear: 2024,
    lengthOverall: 40.5,
    beam: 8,
    draft: 2.4,
    airDraft: 12.5,
    grossTonnage: 300,
    imoNumber: "IMO123",
    mmsi: "456",
    callSign: "ABCD",
    flagState: "Malta",
    registryPort: "Valletta",
    ownerName: "Jane Doe",
    createdAt: "2026-05-24T00:00:00.000Z",
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

describe("shipProfileFormNumberErrors", () => {
  it("is empty for a valid form", () => {
    expect(shipProfileFormNumberErrors(EMPTY_SHIP_PROFILE_FORM)).toEqual([]);
    expect(shipProfileFormNumberErrors({ ...EMPTY_SHIP_PROFILE_FORM, buildYear: "2024", lengthOverall: "40.5" })).toEqual([]);
  });

  it("lists each out-of-range numeric field", () => {
    const errors = shipProfileFormNumberErrors({
      ...EMPTY_SHIP_PROFILE_FORM,
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

describe("shipProfileFormFromView", () => {
  it("seeds every field, stringifying numbers and defaulting nulls to empty", () => {
    const form = shipProfileFormFromView(profile({ model: null, buildYear: null }));
    expect(form.hullNumber).toBe("HULL-1");
    expect(form.shipStatus).toBe("active");
    expect(form.buildYear).toBe("");
    expect(form.model).toBe("");
    expect(form.lengthOverall).toBe("40.5");
  });
});

describe("shipProfileFormToUpdate", () => {
  it("normalizes particulars to null when blank and parses numbers", () => {
    const out = shipProfileFormToUpdate({
      ...EMPTY_SHIP_PROFILE_FORM,
      hullNumber: "H-9",
      builder: "  Acme  ",
      model: "",
      buildYear: "2024",
      beam: "",
    });
    expect(out.hullNumber).toBe("H-9");
    expect(out.builder).toBe("Acme");
    expect(out.model).toBeNull();
    expect(out.buildYear).toBe(2024);
    expect(out.beam).toBeNull();
  });

  it("omits a blank hull number so it is never cleared on edit", () => {
    const out = shipProfileFormToUpdate({ ...EMPTY_SHIP_PROFILE_FORM, hullNumber: "  " });
    expect("hullNumber" in out).toBe(false);
    expect(out.shipStatus).toBe("laid_up");
  });
});
