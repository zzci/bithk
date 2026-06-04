import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { equipmentManufacturers } from "./schema";

export type GlobalEquipmentManufacturerRow = typeof equipmentManufacturers.$inferSelect;

export interface GlobalEquipmentManufacturerView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeGlobalEquipmentManufacturer(row: GlobalEquipmentManufacturerRow): GlobalEquipmentManufacturerView {
  return {
    id: row.id,
    name: row.name,
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

// Map a SQLite UNIQUE-constraint violation on name to a clean 422 instead of
// letting it surface as an unhandled 500.
function rethrowUnique(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("UNIQUE constraint failed"))
    throw new ValidationError("Equipment manufacturer name already exists", { name: "Already exists" });
  throw err;
}

export async function listGlobalEquipmentManufacturers(db: AppDatabase): Promise<readonly GlobalEquipmentManufacturerRow[]> {
  return await db.select().from(equipmentManufacturers).orderBy(desc(equipmentManufacturers.createdAt)).all();
}

export async function resolveGlobalEquipmentManufacturer(db: AppDatabase, id: string): Promise<GlobalEquipmentManufacturerRow | undefined> {
  return await db.select().from(equipmentManufacturers).where(eq(equipmentManufacturers.id, id)).get();
}

export interface CreateGlobalEquipmentManufacturerInput {
  readonly name: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createGlobalEquipmentManufacturer(db: AppDatabase, input: CreateGlobalEquipmentManufacturerInput): Promise<GlobalEquipmentManufacturerRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await db.insert(equipmentManufacturers).values({
      id,
      name: input.name.trim(),
      code: trimOptional(input.code),
      description: trimOptional(input.description),
      createdAt: now,
      updatedAt: now,
    }).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return (await db.select().from(equipmentManufacturers).where(eq(equipmentManufacturers.id, id)).get())!;
}

export interface UpdateGlobalEquipmentManufacturerInput {
  readonly name?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateGlobalEquipmentManufacturer(
  db: AppDatabase,
  id: string,
  input: UpdateGlobalEquipmentManufacturerInput,
): Promise<GlobalEquipmentManufacturerRow | undefined> {
  const existing = await resolveGlobalEquipmentManufacturer(db, id);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.name !== undefined)
    patch.name = input.name.trim();
  if (input.code !== undefined)
    patch.code = trimOptional(input.code);
  if (input.description !== undefined)
    patch.description = trimOptional(input.description);
  try {
    await db.update(equipmentManufacturers).set(patch).where(eq(equipmentManufacturers.id, id)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await db.select().from(equipmentManufacturers).where(eq(equipmentManufacturers.id, id)).get();
}

export async function deleteGlobalEquipmentManufacturer(db: AppDatabase, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(equipmentManufacturers)
    .where(eq(equipmentManufacturers.id, id))
    .run());
  return result.changes > 0;
}
