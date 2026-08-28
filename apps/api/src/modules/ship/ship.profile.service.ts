import type { ShipStatus } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ValidationError } from "@/shared/lib/errors";
import { shipProfiles } from "./schema";

export type ShipProfileRow = typeof shipProfiles.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// The profile is always addressed through its project's short id in the URL,
// so `projectId` (the internal ULID) never leaves the API. Everything a project
// already carries — name, description, cover, creator, version, tags — stays on
// the project payload; this view holds only the maritime attributes.

export interface ShipProfileView {
  readonly hullNumber: string;
  readonly shipStatus: ShipStatus;
  readonly model: string | null;
  readonly builder: string | null;
  readonly buildYear: number | null;
  readonly lengthOverall: number | null;
  readonly beam: number | null;
  readonly draft: number | null;
  readonly airDraft: number | null;
  readonly grossTonnage: number | null;
  readonly imoNumber: string | null;
  readonly mmsi: string | null;
  readonly callSign: string | null;
  readonly flagState: string | null;
  readonly registryPort: string | null;
  readonly ownerName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeShipProfile(row: ShipProfileRow): ShipProfileView {
  return {
    hullNumber: row.hullNumber,
    shipStatus: row.shipStatus,
    model: row.model,
    builder: row.builder,
    buildYear: row.buildYear,
    lengthOverall: row.lengthOverall,
    beam: row.beam,
    draft: row.draft,
    airDraft: row.airDraft,
    grossTonnage: row.grossTonnage,
    imoNumber: row.imoNumber,
    mmsi: row.mmsi,
    callSign: row.callSign,
    flagState: row.flagState,
    registryPort: row.registryPort,
    ownerName: row.ownerName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Create payload (validated by the ship module, not the project module) ───
// The `ship-profile` slice of `POST /projects`'s `sectionData` (PLAN-108 §3):
// the project module hands the raw value through without interpreting it, so
// the shape is declared and enforced here.

const shipProfileFields = {
  model: z.string().max(255).nullable().optional(),
  builder: z.string().max(255).nullable().optional(),
  buildYear: z.number().int().min(1800).max(2200).nullable().optional(),
  lengthOverall: z.number().nonnegative().nullable().optional(),
  beam: z.number().nonnegative().nullable().optional(),
  draft: z.number().nonnegative().nullable().optional(),
  airDraft: z.number().nonnegative().nullable().optional(),
  grossTonnage: z.number().nonnegative().nullable().optional(),
  imoNumber: z.string().max(50).nullable().optional(),
  mmsi: z.string().max(50).nullable().optional(),
  callSign: z.string().max(50).nullable().optional(),
  flagState: z.string().max(100).nullable().optional(),
  registryPort: z.string().max(100).nullable().optional(),
  ownerName: z.string().max(255).nullable().optional(),
};

/**
 * The `sectionData["ship-profile"]` slice. `hullNumber` is optional: a project
 * created with the ship preset but no particulars still gets a profile row, so
 * "section mounted" and "profile row exists" stay equivalent.
 */
export const shipProfileSectionDataSchema = z.object({
  hullNumber: z.string().trim().min(1).max(100).optional(),
  shipStatus: z.enum(["under_construction", "active", "underway", "in_maintenance", "laid_up", "retired"]).optional(),
  ...shipProfileFields,
});

export type ShipProfileSectionData = z.infer<typeof shipProfileSectionDataSchema>;

export const updateShipProfileSchema = z.object({
  hullNumber: z.string().trim().min(1).max(100).optional(),
  shipStatus: z.enum(["under_construction", "active", "underway", "in_maintenance", "laid_up", "retired"]).optional(),
  ...shipProfileFields,
}).refine(
  v => Object.values(v).some(value => value !== undefined),
  { message: "At least one field must be provided" },
);

export type UpdateShipProfileInput = z.infer<typeof updateShipProfileSchema>;

// Map a SQLite UNIQUE-constraint violation on `hull_number` to a clean 422
// instead of letting it surface as an unhandled 500.
function rethrowUnique(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("UNIQUE constraint failed"))
    throw new ValidationError("Hull number already exists", { hullNumber: "Already exists" });
  throw err;
}

// ─── Provisioning ────────────────────────────────────────────────────────

/**
 * Insert the profile row for a project mounting the `ship-profile` section.
 * Synchronous by contract (`ProjectSectionDefinition.provision`): bun:sqlite
 * transactions are synchronous, so every write must land before COMMIT.
 *
 * `raw` is the untyped `sectionData["ship-profile"]` slice; it is validated
 * here so the project module never learns this section's shape.
 */
export function provisionShipProfileTx(tx: AppTransaction, projectId: string, raw: unknown, now: string): void {
  const parsed = shipProfileSectionDataSchema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new ValidationError("Invalid ship-profile section data", flattenIssues(parsed.error));
  const input = parsed.data;

  try {
    tx.insert(shipProfiles).values({
      projectId,
      // A hull number is the vessel's identifier; default it to the project's
      // own ULID-free short handle when the caller supplies none, so the
      // NOT NULL + UNIQUE column always has a value it can later rename.
      hullNumber: input.hullNumber ?? `S-${projectId.slice(-8).toUpperCase()}`,
      shipStatus: input.shipStatus ?? "laid_up",
      model: input.model ?? null,
      builder: input.builder ?? null,
      buildYear: input.buildYear ?? null,
      lengthOverall: input.lengthOverall ?? null,
      beam: input.beam ?? null,
      draft: input.draft ?? null,
      airDraft: input.airDraft ?? null,
      grossTonnage: input.grossTonnage ?? null,
      imoNumber: input.imoNumber ?? null,
      mmsi: input.mmsi ?? null,
      callSign: input.callSign ?? null,
      flagState: input.flagState ?? null,
      registryPort: input.registryPort ?? null,
      ownerName: input.ownerName ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
}

/** Flatten a zod error into the `{ field: message }` shape ValidationError carries. */
function flattenIssues(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues)
    details[issue.path.join(".") || "sectionData"] = issue.message;
  return details;
}

// ─── Profile CRUD (scoped to a project by internal id) ─────────────────────

export async function getShipProfile(db: AppDatabase, projectId: string): Promise<ShipProfileRow | undefined> {
  return await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, projectId)).get();
}

/** True when the project holds a ship profile — the `ship-profile` section's `hasData`. */
export async function hasShipProfile(db: AppDatabase, projectId: string): Promise<boolean> {
  const row = await db.select({ projectId: shipProfiles.projectId })
    .from(shipProfiles)
    .where(eq(shipProfiles.projectId, projectId))
    .get();
  return row !== undefined;
}

const UPDATABLE_PROFILE_KEYS = [
  "hullNumber",
  "shipStatus",
  "model",
  "builder",
  "buildYear",
  "lengthOverall",
  "beam",
  "draft",
  "airDraft",
  "grossTonnage",
  "imoNumber",
  "mmsi",
  "callSign",
  "flagState",
  "registryPort",
  "ownerName",
] as const;

export async function updateShipProfile(
  db: AppDatabase,
  projectId: string,
  input: UpdateShipProfileInput,
): Promise<ShipProfileRow | undefined> {
  const existing = await getShipProfile(db, projectId);
  if (!existing)
    return undefined;

  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of UPDATABLE_PROFILE_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  try {
    await db.update(shipProfiles).set(patch).where(eq(shipProfiles.projectId, projectId)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await getShipProfile(db, projectId);
}
