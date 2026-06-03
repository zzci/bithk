import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { globalEquipmentCategories } from "./schema";

export type GlobalEquipmentCategoryRow = typeof globalEquipmentCategories.$inferSelect;

export interface GlobalEquipmentCategoryView {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeGlobalEquipmentCategory(row: GlobalEquipmentCategoryRow): GlobalEquipmentCategoryView {
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

export async function listGlobalEquipmentCategories(db: AppDatabase): Promise<readonly GlobalEquipmentCategoryRow[]> {
  return await db.select().from(globalEquipmentCategories).orderBy(desc(globalEquipmentCategories.createdAt)).all();
}

export async function resolveGlobalEquipmentCategory(db: AppDatabase, id: string): Promise<GlobalEquipmentCategoryRow | undefined> {
  return await db.select().from(globalEquipmentCategories).where(eq(globalEquipmentCategories.id, id)).get();
}

export interface CreateGlobalEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createGlobalEquipmentCategory(db: AppDatabase, input: CreateGlobalEquipmentCategoryInput): Promise<GlobalEquipmentCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await db.insert(globalEquipmentCategories).values({
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
  return (await db.select().from(globalEquipmentCategories).where(eq(globalEquipmentCategories.id, id)).get())!;
}

export interface UpdateGlobalEquipmentCategoryInput {
  readonly nameZh?: string | undefined;
  readonly nameEn?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateGlobalEquipmentCategory(
  db: AppDatabase,
  id: string,
  input: UpdateGlobalEquipmentCategoryInput,
): Promise<GlobalEquipmentCategoryRow | undefined> {
  const existing = await resolveGlobalEquipmentCategory(db, id);
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
    await db.update(globalEquipmentCategories).set(patch).where(eq(globalEquipmentCategories.id, id)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await db.select().from(globalEquipmentCategories).where(eq(globalEquipmentCategories.id, id)).get();
}

export async function deleteGlobalEquipmentCategory(db: AppDatabase, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(globalEquipmentCategories)
    .where(eq(globalEquipmentCategories.id, id))
    .run());
  return result.changes > 0;
}
