import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { equipmentCategories } from "./schema";

export type EquipmentCategoryRow = typeof equipmentCategories.$inferSelect;

export interface EquipmentCategoryView {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeEquipmentCategory(row: EquipmentCategoryRow): EquipmentCategoryView {
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

// Map a SQLite UNIQUE-constraint violation on name_zh / name_en to a clean 422
// instead of letting it surface as an unhandled 500.
function rethrowUnique(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("UNIQUE constraint failed")) {
    const field = message.includes("name_en") ? "nameEn" : "nameZh";
    throw new ValidationError("Equipment category name already exists", { [field]: "Already exists" });
  }
  throw err;
}

export async function listEquipmentCategories(db: AppDatabase): Promise<readonly EquipmentCategoryRow[]> {
  return await db.select().from(equipmentCategories).orderBy(desc(equipmentCategories.createdAt)).all();
}

export async function resolveEquipmentCategory(db: AppDatabase, id: string): Promise<EquipmentCategoryRow | undefined> {
  return await db.select().from(equipmentCategories).where(eq(equipmentCategories.id, id)).get();
}

export interface CreateEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createEquipmentCategory(db: AppDatabase, input: CreateEquipmentCategoryInput): Promise<EquipmentCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await db.insert(equipmentCategories).values({
      id,
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
  return (await db.select().from(equipmentCategories).where(eq(equipmentCategories.id, id)).get())!;
}

export interface UpdateEquipmentCategoryInput {
  readonly nameZh?: string | undefined;
  readonly nameEn?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateEquipmentCategory(
  db: AppDatabase,
  id: string,
  input: UpdateEquipmentCategoryInput,
): Promise<EquipmentCategoryRow | undefined> {
  const existing = await resolveEquipmentCategory(db, id);
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
    await db.update(equipmentCategories).set(patch).where(eq(equipmentCategories.id, id)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await db.select().from(equipmentCategories).where(eq(equipmentCategories.id, id)).get();
}

export async function deleteEquipmentCategory(db: AppDatabase, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(equipmentCategories)
    .where(eq(equipmentCategories.id, id))
    .run());
  return result.changes > 0;
}
