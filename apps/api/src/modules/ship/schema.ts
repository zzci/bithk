import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { fileReferences } from "@/modules/file/schema";
import { projects } from "@/modules/project/schema";

export const SHIP_STATUSES = ["active", "archived"] as const;
export type ShipStatus = typeof SHIP_STATUSES[number];

export const SHIP_LIFECYCLE_STAGES = [
  "design",
  "building",
  "sea_trial",
  "in_service",
  "maintenance",
  "decommissioned",
] as const;
export type ShipLifecycleStage = typeof SHIP_LIFECYCLE_STAGES[number];

export const EQUIPMENT_STATUSES = ["active", "retired"] as const;
export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];

// A ship is a long-lived asset. It carries only its own attributes and anchors
// permissions on an auto-created "base project" (`baseProjectId`) which also
// hosts its files (drive) and work orders (issues). The FK to `projects` is
// nullable so the circular `ships.baseProjectId ↔ projects.shipId` link can be
// written inside one transaction (insert ship → create project → backfill).
export const ships = sqliteTable("ships", {
  id: text("id").primaryKey(), // ulid
  shortId: text("short_id").notNull(), // nanoid, exposed in URL/API
  code: text("code").notNull(), // hull number, unique
  name: text("name").notNull(),
  status: text("status", { enum: SHIP_STATUSES }).notNull().default("active"),
  lifecycleStage: text("lifecycle_stage", { enum: SHIP_LIFECYCLE_STAGES }).notNull().default("design"),
  // Permission anchor + file carrier. Nullable circular FK (see header).
  // Explicit return type breaks the projects ↔ ships circular type inference.
  baseProjectId: text("base_project_id").references((): AnySQLiteColumn => projects.id, { onDelete: "set null" }),
  // Yacht core attributes.
  model: text("model"),
  builder: text("builder"),
  buildYear: integer("build_year"),
  lengthOverall: real("length_overall"),
  beam: real("beam"),
  draft: real("draft"),
  grossTonnage: real("gross_tonnage"),
  imoNumber: text("imo_number"),
  mmsi: text("mmsi"),
  callSign: text("call_sign"),
  flagState: text("flag_state"),
  registryPort: text("registry_port"),
  ownerName: text("owner_name"),
  description: text("description"),
  // Optional cover image: a `file_references` row with owner_type 'ship_cover'.
  // Nulled automatically when that reference is released.
  coverReferenceId: text("cover_reference_id").references((): AnySQLiteColumn => fileReferences.id, { onDelete: "set null" }),
  creatorId: text("creator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deletedAt: text("deleted_at"),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("ships_short_id_idx").on(t.shortId),
  uniqueIndex("ships_code_idx").on(t.code),
  index("ships_status_idx").on(t.status, t.deletedAt),
  index("ships_base_project_idx").on(t.baseProjectId),
]);

// Equipment inventory for a ship. CRUD routes land in a later phase; the table
// is defined now so the single foundation migration covers it.
export const shipEquipment = sqliteTable("ship_equipment", {
  id: text("id").primaryKey(), // nanoid
  shipId: text("ship_id").notNull().references(() => ships.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  location: text("location"),
  installedAt: text("installed_at"),
  status: text("status", { enum: EQUIPMENT_STATUSES }).notNull().default("active"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("ship_equipment_ship_idx").on(t.shipId)]);

// Maintenance templates. `shipId` NULL = a global knowledge-base entry (copy
// source only); a value = a ship-level copy the ship actually uses. CRUD routes
// land in a later phase; defined now to keep one foundation migration.
export const maintenanceTemplates = sqliteTable("maintenance_templates", {
  id: text("id").primaryKey(), // nanoid
  shipId: text("ship_id").references(() => ships.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  checklist: text("checklist"),
  precautions: text("precautions"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("maintenance_templates_ship_idx").on(t.shipId)]);
