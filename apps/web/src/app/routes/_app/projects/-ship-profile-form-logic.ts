// Pure helpers for the ship-profile edit form, extracted so the field
// normalization (trimming, number parsing, empty → null) and the sane-range
// validation are unit-testable without a render harness.
//
// Scope is exactly the `ship-profile` section's payload: the hull number, the
// vessel lifecycle status and the maritime particulars. Name, description,
// record status, cover and tags belong to the PROJECT and are edited through
// the project settings dialog, not here.

import type { ShipProfileInput, ShipProfileView, ShipStatus } from "@/shared/lib/api/project-sections";

export interface ShipProfileFormState {
  readonly hullNumber: string;
  readonly shipStatus: ShipStatus;
  readonly model: string;
  readonly builder: string;
  readonly buildYear: string;
  readonly lengthOverall: string;
  readonly beam: string;
  readonly draft: string;
  readonly airDraft: string;
  readonly grossTonnage: string;
  readonly imoNumber: string;
  readonly mmsi: string;
  readonly callSign: string;
  readonly flagState: string;
  readonly registryPort: string;
  readonly ownerName: string;
}

export const EMPTY_SHIP_PROFILE_FORM: ShipProfileFormState = {
  hullNumber: "",
  shipStatus: "laid_up",
  model: "",
  builder: "",
  buildYear: "",
  lengthOverall: "",
  beam: "",
  draft: "",
  airDraft: "",
  grossTonnage: "",
  imoNumber: "",
  mmsi: "",
  callSign: "",
  flagState: "",
  registryPort: "",
  ownerName: "",
};

/** Stringify a nullable number for an input value ("" when unset). */
function numToInput(v: number | null): string {
  return v === null ? "" : String(v);
}

/** Seed the form from the project's current ship-profile payload. */
export function shipProfileFormFromView(profile: ShipProfileView): ShipProfileFormState {
  return {
    hullNumber: profile.hullNumber,
    shipStatus: profile.shipStatus,
    model: profile.model ?? "",
    builder: profile.builder ?? "",
    buildYear: numToInput(profile.buildYear),
    lengthOverall: numToInput(profile.lengthOverall),
    beam: numToInput(profile.beam),
    draft: numToInput(profile.draft),
    airDraft: numToInput(profile.airDraft),
    grossTonnage: numToInput(profile.grossTonnage),
    imoNumber: profile.imoNumber ?? "",
    mmsi: profile.mmsi ?? "",
    callSign: profile.callSign ?? "",
    flagState: profile.flagState ?? "",
    registryPort: profile.registryPort ?? "",
    ownerName: profile.ownerName ?? "",
  };
}

/** Trimmed string, or null when blank (the PUT clears the column). */
function textOrNull(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Parsed finite number, or null when blank / not a number. */
export function parseNumberOrNull(v: string): number | null {
  const t = v.trim();
  if (t.length === 0)
    return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

interface FieldRange {
  readonly min: number;
  readonly max: number;
  /** When true the value must be strictly greater than `min` (e.g. dimensions > 0). */
  readonly exclusiveMin?: boolean;
}

/**
 * Sane ranges for the numeric particulars. Build year is bounded to a plausible
 * window; the physical dimensions and tonnage must be strictly positive with a
 * generous upper bound so impossible values (negatives, zero, absurd magnitudes)
 * are rejected before they reach the API.
 */
export type ShipNumberField = "buildYear" | "lengthOverall" | "beam" | "draft" | "airDraft" | "grossTonnage";

export const SHIP_NUMBER_FIELD_RANGES: Record<ShipNumberField, FieldRange> = {
  buildYear: { min: 1900, max: CURRENT_YEAR + 1 },
  lengthOverall: { min: 0, max: 600, exclusiveMin: true },
  beam: { min: 0, max: 100, exclusiveMin: true },
  draft: { min: 0, max: 50, exclusiveMin: true },
  airDraft: { min: 0, max: 150, exclusiveMin: true },
  grossTonnage: { min: 0, max: 1_000_000, exclusiveMin: true },
};

/**
 * Validate a single numeric field's raw input. Blank is allowed (the fields are
 * optional); a non-blank value must parse to a finite number inside the field's
 * sane range.
 */
export function isNumberFieldValid(field: ShipNumberField, raw: string): boolean {
  const t = raw.trim();
  if (t.length === 0)
    return true;
  const n = Number(t);
  if (!Number.isFinite(n))
    return false;
  const { min, max, exclusiveMin } = SHIP_NUMBER_FIELD_RANGES[field];
  if (exclusiveMin ? n <= min : n < min)
    return false;
  return n <= max;
}

/** The numeric fields whose current value is out of range (empty result == valid). */
export function shipProfileFormNumberErrors(state: ShipProfileFormState): ShipNumberField[] {
  return (Object.keys(SHIP_NUMBER_FIELD_RANGES) as ShipNumberField[])
    .filter(field => !isNumberFieldValid(field, state[field]));
}

/**
 * Build the PUT body. A blank hull number is omitted rather than sent empty —
 * the API keeps the existing one; every other field clears to null when blank.
 */
export function shipProfileFormToUpdate(state: ShipProfileFormState): ShipProfileInput {
  return {
    shipStatus: state.shipStatus,
    ...(state.hullNumber.trim() ? { hullNumber: state.hullNumber.trim() } : {}),
    model: textOrNull(state.model),
    builder: textOrNull(state.builder),
    buildYear: parseNumberOrNull(state.buildYear),
    lengthOverall: parseNumberOrNull(state.lengthOverall),
    beam: parseNumberOrNull(state.beam),
    draft: parseNumberOrNull(state.draft),
    airDraft: parseNumberOrNull(state.airDraft),
    grossTonnage: parseNumberOrNull(state.grossTonnage),
    imoNumber: textOrNull(state.imoNumber),
    mmsi: textOrNull(state.mmsi),
    callSign: textOrNull(state.callSign),
    flagState: textOrNull(state.flagState),
    registryPort: textOrNull(state.registryPort),
    ownerName: textOrNull(state.ownerName),
  };
}
