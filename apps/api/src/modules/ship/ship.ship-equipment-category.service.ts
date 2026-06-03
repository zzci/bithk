import type { AppDatabase, AppTransaction } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { globalEquipmentCategories, shipEquipmentCategories } from "./schema";

export type ShipEquipmentCategoryRow = typeof shipEquipmentCategories.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `shipId` is the internal ship ULID and never leaves the API: per-ship
// categories are always addressed through their parent ship's short id in the
// URL, so the view omits it and exposes only the category's own (nanoid) id.
export interface ShipEquipmentCategoryView {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeShipEquipmentCategory(row: ShipEquipmentCategoryRow): ShipEquipmentCategoryView {
  return {
    id: row.id,
    nameZh: row.nameZh,
    nameEn: row.nameEn,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Trim a free-text field; an empty result for the optional code/description
// collapses to null so the vocabulary never stores blank-but-non-null values.
function trimOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null)
    return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Map a SQLite UNIQUE-constraint violation on (ship_id, name_zh|name_en) to a
// clean 422 instead of letting it surface as an unhandled 500.
function rethrowUnique(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("UNIQUE constraint failed")) {
    const field = message.includes("name_en") ? "nameEn" : "nameZh";
    throw new ValidationError("Equipment category name already exists", { [field]: "Already exists" });
  }
  throw err;
}

// ─── Per-ship category CRUD (scoped to a ship by internal id) ──────────────

export async function listShipEquipmentCategories(db: AppDatabase, shipInternalId: string): Promise<readonly ShipEquipmentCategoryRow[]> {
  return await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, shipInternalId)).orderBy(desc(shipEquipmentCategories.createdAt)).all();
}

export async function resolveShipEquipmentCategory(db: AppDatabase, shipInternalId: string, id: string): Promise<ShipEquipmentCategoryRow | undefined> {
  return await db.select().from(shipEquipmentCategories).where(
    and(eq(shipEquipmentCategories.id, id), eq(shipEquipmentCategories.shipId, shipInternalId)),
  ).get();
}

export interface CreateShipEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createShipEquipmentCategory(db: AppDatabase, shipInternalId: string, input: CreateShipEquipmentCategoryInput): Promise<ShipEquipmentCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await db.insert(shipEquipmentCategories).values({
      id,
      shipId: shipInternalId,
      nameZh: input.nameZh.trim(),
      nameEn: input.nameEn.trim(),
      code: trimOptional(input.code),
      description: trimOptional(input.description),
      createdAt: now,
      updatedAt: now,
    }).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return (await resolveShipEquipmentCategory(db, shipInternalId, id))!;
}

export interface UpdateShipEquipmentCategoryInput {
  readonly nameZh?: string | undefined;
  readonly nameEn?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateShipEquipmentCategory(
  db: AppDatabase,
  shipInternalId: string,
  id: string,
  input: UpdateShipEquipmentCategoryInput,
): Promise<ShipEquipmentCategoryRow | undefined> {
  const existing = await resolveShipEquipmentCategory(db, shipInternalId, id);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.nameZh !== undefined)
    patch.nameZh = input.nameZh.trim();
  if (input.nameEn !== undefined)
    patch.nameEn = input.nameEn.trim();
  if (input.code !== undefined)
    patch.code = trimOptional(input.code);
  if (input.description !== undefined)
    patch.description = trimOptional(input.description);
  try {
    await db.update(shipEquipmentCategories).set(patch).where(eq(shipEquipmentCategories.id, existing.id)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await resolveShipEquipmentCategory(db, shipInternalId, id);
}

export async function deleteShipEquipmentCategory(db: AppDatabase, shipInternalId: string, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(shipEquipmentCategories)
    .where(and(eq(shipEquipmentCategories.id, id), eq(shipEquipmentCategories.shipId, shipInternalId)))
    .run());
  return result.changes > 0;
}

/**
 * Copy the current global equipment-category template into a newly created
 * ship's `ship_equipment_categories`. Synchronous so it composes into the
 * `createShip` transaction (copy-on-create — later global edits never touch
 * this ship). Mirrors `seedProjectCategoriesTx` for procurement categories.
 */
export function seedShipEquipmentCategoriesTx(tx: AppTransaction, shipInternalId: string, now: string): void {
  const globals = tx.select().from(globalEquipmentCategories).all();
  for (const g of globals) {
    tx.insert(shipEquipmentCategories).values({
      id: nanoid(),
      shipId: shipInternalId,
      nameZh: g.nameZh,
      nameEn: g.nameEn,
      code: g.code,
      description: g.description,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}
