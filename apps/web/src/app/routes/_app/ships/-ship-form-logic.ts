// Pure helpers for the ship create/edit form, extracted so the field
// normalization (trimming, number parsing, empty → null) is unit-testable
// without a render harness.

import type { CreateShipInput, ShipStatus, ShipView, UpdateShipInput } from "@/shared/lib/api/ships";

export interface ShipFormState {
  readonly name: string;
  readonly code: string;
  readonly status: ShipStatus;
  readonly model: string;
  readonly builder: string;
  readonly buildYear: string;
  readonly lengthOverall: string;
  readonly beam: string;
  readonly draft: string;
  readonly grossTonnage: string;
  readonly imoNumber: string;
  readonly mmsi: string;
  readonly callSign: string;
  readonly flagState: string;
  readonly registryPort: string;
  readonly ownerName: string;
  readonly description: string;
}

export const EMPTY_SHIP_FORM: ShipFormState = {
  name: "",
  code: "",
  status: "active",
  model: "",
  builder: "",
  buildYear: "",
  lengthOverall: "",
  beam: "",
  draft: "",
  grossTonnage: "",
  imoNumber: "",
  mmsi: "",
  callSign: "",
  flagState: "",
  registryPort: "",
  ownerName: "",
  description: "",
};

/** Stringify a nullable number for an input value ("" when unset). */
function numToInput(v: number | null): string {
  return v === null ? "" : String(v);
}

/** Seed the form from an existing ship (edit mode). */
export function shipFormFromView(ship: ShipView): ShipFormState {
  return {
    name: ship.name,
    code: ship.code,
    status: ship.status,
    model: ship.model ?? "",
    builder: ship.builder ?? "",
    buildYear: numToInput(ship.buildYear),
    lengthOverall: numToInput(ship.lengthOverall),
    beam: numToInput(ship.beam),
    draft: numToInput(ship.draft),
    grossTonnage: numToInput(ship.grossTonnage),
    imoNumber: ship.imoNumber ?? "",
    mmsi: ship.mmsi ?? "",
    callSign: ship.callSign ?? "",
    flagState: ship.flagState ?? "",
    registryPort: ship.registryPort ?? "",
    ownerName: ship.ownerName ?? "",
    description: ship.description ?? "",
  };
}

/** Trimmed string, or null when blank (PATCH clears the column). */
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

/** The descriptive (non-core) ship columns, normalized for a PATCH body. */
function descriptiveFields(state: ShipFormState): Omit<UpdateShipInput, "name" | "code" | "status"> {
  return {
    model: textOrNull(state.model),
    builder: textOrNull(state.builder),
    buildYear: parseNumberOrNull(state.buildYear),
    lengthOverall: parseNumberOrNull(state.lengthOverall),
    beam: parseNumberOrNull(state.beam),
    draft: parseNumberOrNull(state.draft),
    grossTonnage: parseNumberOrNull(state.grossTonnage),
    imoNumber: textOrNull(state.imoNumber),
    mmsi: textOrNull(state.mmsi),
    callSign: textOrNull(state.callSign),
    flagState: textOrNull(state.flagState),
    registryPort: textOrNull(state.registryPort),
    ownerName: textOrNull(state.ownerName),
    description: textOrNull(state.description),
  };
}

/**
 * Build the create payload. Code is omitted when blank so the API generates a
 * hull number. Descriptive fields are not part of the create form (kept
 * minimal); they are set later via edit.
 */
export function shipFormToCreate(state: ShipFormState): CreateShipInput {
  return {
    name: state.name.trim(),
    status: state.status,
    ...(state.code.trim() ? { code: state.code.trim() } : {}),
  };
}

/** Build the update payload (full field set; blank code is omitted, never cleared). */
export function shipFormToUpdate(state: ShipFormState): UpdateShipInput {
  return {
    name: state.name.trim(),
    status: state.status,
    ...(state.code.trim() ? { code: state.code.trim() } : {}),
    ...descriptiveFields(state),
  };
}
