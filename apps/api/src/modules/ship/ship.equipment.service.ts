import type { EquipmentStatus } from "./schema";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { shipEquipment } from "./schema";

export type ShipEquipmentRow = typeof shipEquipment.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `shipId` is the internal ship ULID and never leaves the API: equipment is
// always addressed through its parent ship's short id in the URL, so the view
// omits it and exposes only the equipment's own (nanoid) id.

export interface ShipEquipmentView {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly location: string | null;
  readonly installedAt: string | null;
  readonly status: EquipmentStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeEquipment(row: ShipEquipmentRow): ShipEquipmentView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serialNumber,
    location: row.location,
    installedAt: row.installedAt,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Equipment CRUD (scoped to a ship by internal id) ──────────────────────

export async function listEquipment(db: AppDatabase, shipInternalId: string): Promise<readonly ShipEquipmentView[]> {
  const rows = await db.select().from(shipEquipment).where(eq(shipEquipment.shipId, shipInternalId)).orderBy(desc(shipEquipment.id)).all();
  return rows.map(composeEquipment);
}

export async function getEquipment(db: AppDatabase, shipInternalId: string, equipmentId: string): Promise<ShipEquipmentRow | undefined> {
  return await db.select().from(shipEquipment).where(
    and(eq(shipEquipment.shipId, shipInternalId), eq(shipEquipment.id, equipmentId)),
  ).get();
}

export interface CreateEquipmentInput {
  readonly name: string;
  readonly category?: string | null | undefined;
  readonly manufacturer?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly installedAt?: string | null | undefined;
  readonly status?: EquipmentStatus | undefined;
  readonly note?: string | null | undefined;
}

export async function createEquipment(db: AppDatabase, shipInternalId: string, input: CreateEquipmentInput): Promise<ShipEquipmentRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(shipEquipment).values({
    id,
    shipId: shipInternalId,
    name: input.name,
    category: input.category ?? null,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    location: input.location ?? null,
    installedAt: input.installedAt ?? null,
    status: input.status ?? "active",
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(shipEquipment).where(eq(shipEquipment.id, id)).get())!;
}

export interface UpdateEquipmentInput {
  readonly name?: string | undefined;
  readonly category?: string | null | undefined;
  readonly manufacturer?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly installedAt?: string | null | undefined;
  readonly status?: EquipmentStatus | undefined;
  readonly note?: string | null | undefined;
}

const UPDATABLE_EQUIPMENT_KEYS = [
  "name",
  "category",
  "manufacturer",
  "model",
  "serialNumber",
  "location",
  "installedAt",
  "status",
  "note",
] as const;

export async function updateEquipment(db: AppDatabase, shipInternalId: string, equipmentId: string, input: UpdateEquipmentInput): Promise<ShipEquipmentRow | undefined> {
  const existing = await getEquipment(db, shipInternalId, equipmentId);
  if (!existing)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const key of UPDATABLE_EQUIPMENT_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  await db.update(shipEquipment).set(patch).where(eq(shipEquipment.id, existing.id)).run();
  return await db.select().from(shipEquipment).where(eq(shipEquipment.id, existing.id)).get();
}

export async function deleteEquipment(db: AppDatabase, shipInternalId: string, equipmentId: string): Promise<boolean> {
  const existing = await getEquipment(db, shipInternalId, equipmentId);
  if (!existing)
    return false;
  await db.delete(shipEquipment).where(eq(shipEquipment.id, existing.id)).run();
  return true;
}
