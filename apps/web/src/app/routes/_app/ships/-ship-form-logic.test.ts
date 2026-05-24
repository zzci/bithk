import type { ShipView } from "@/shared/lib/api/ships";
import { describe, expect, it } from "vitest";
import {
  EMPTY_SHIP_FORM,
  parseNumberOrNull,
  shipFormFromView,
  shipFormToCreate,
  shipFormToUpdate,
} from "./-ship-form-logic";

function ship(overrides: Partial<ShipView> = {}): ShipView {
  return {
    id: "s1",
    code: "HULL-1",
    name: "Serenity",
    status: "active",
    lifecycleStage: "building",
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

describe("shipFormFromView", () => {
  it("seeds every field, stringifying numbers and defaulting nulls to empty", () => {
    const form = shipFormFromView(ship({ model: null, buildYear: null }));
    expect(form.name).toBe("Serenity");
    expect(form.code).toBe("HULL-1");
    expect(form.lifecycleStage).toBe("building");
    expect(form.buildYear).toBe("");
    expect(form.model).toBe("");
    expect(form.lengthOverall).toBe("40.5");
  });
});

describe("shipFormToCreate", () => {
  it("trims the name and omits a blank code (API auto-generates it)", () => {
    const out = shipFormToCreate({ ...EMPTY_SHIP_FORM, name: "  Aurora  ", lifecycleStage: "design" });
    expect(out).toEqual({ name: "Aurora", status: "active", lifecycleStage: "design" });
    expect("code" in out).toBe(false);
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
