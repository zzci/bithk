import type { ShipStatus } from "./schema";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { FileServiceConfig } from "@/modules/file";
import type { ProjectView } from "@/modules/project/project.service";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { releaseReference, uploadAndReference } from "@/modules/file";
import { fileReferences } from "@/modules/file/schema";
import {
  composeProject,
  createProjectTx,
  hasCapability,
  isMember,
} from "@/modules/project/project.service";
import { projectMembers, projects } from "@/modules/project/schema";
import {
  deleteResourceTags,
  listResourceIdsByTag,
  loadResourceTagsByResource,
  syncResourceTagsTx,
} from "@/modules/tag/tag.service";
import { nanoid, ulid } from "@/shared/lib/id";
import { ships } from "./schema";

/** Ship tag binding (tag type='ship'), passed to the shared tag helpers. */
const SHIP_TAG_BINDING = {
  type: "ship",
} as const;

/** owner_type discriminator for a ship's cover image file reference. */
export const SHIP_COVER_OWNER_TYPE = "ship_cover";

/** Build the inline content URL the frontend renders in an <img>. */
function buildCoverUrl(fileId: string, referenceId: string): string {
  return `/api/files/${fileId}/content?ref=${referenceId}&inline=true`;
}

// Escape SQLite LIKE wildcards so user input is matched literally. Every LIKE
// built from this MUST carry `ESCAPE '\'`.
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, "\\$&");
}

export type ShipRow = typeof ships.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// Routes return this instead of the raw row: `shortId` is the sole external
// ship identifier, the internal ULID and soft-delete marker never leave the
// API, and `baseProjectId` is exposed as the base project's *short* id so the
// frontend can render that project's drive directly.

export interface ShipView {
  readonly id: string; // ship short_id
  readonly code: string;
  readonly name: string;
  readonly status: ShipStatus;
  readonly tags: readonly { id: string; name: string }[];
  readonly baseProjectId: string | null; // base project short_id (for files/drive)
  readonly model: string | null;
  readonly builder: string | null;
  readonly buildYear: number | null;
  readonly lengthOverall: number | null;
  readonly beam: number | null;
  readonly draft: number | null;
  readonly grossTonnage: number | null;
  readonly imoNumber: string | null;
  readonly mmsi: string | null;
  readonly callSign: string | null;
  readonly flagState: string | null;
  readonly registryPort: string | null;
  readonly ownerName: string | null;
  readonly description: string | null;
  readonly coverImageUrl: string | null;
  readonly creatorId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ShipProjectView extends ProjectView {
  readonly isBase: boolean;
}

export function composeShip(
  row: ShipRow,
  baseProjectShortId: string | null,
  coverImageUrl: string | null = null,
  tags: readonly { id: string; name: string }[] = [],
): ShipView {
  return {
    id: row.shortId,
    code: row.code,
    name: row.name,
    status: row.status,
    tags,
    baseProjectId: baseProjectShortId,
    model: row.model,
    builder: row.builder,
    buildYear: row.buildYear,
    lengthOverall: row.lengthOverall,
    beam: row.beam,
    draft: row.draft,
    grossTonnage: row.grossTonnage,
    imoNumber: row.imoNumber,
    mmsi: row.mmsi,
    callSign: row.callSign,
    flagState: row.flagState,
    registryPort: row.registryPort,
    ownerName: row.ownerName,
    description: row.description,
    coverImageUrl,
    creatorId: row.creatorId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** Map cover `file_references` ids to their inline content URL. */
async function loadCoverUrlsByReference(db: AppDatabase, referenceIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (referenceIds.length === 0)
    return map;
  const rows = await db.select({ id: fileReferences.id, fileId: fileReferences.fileId })
    .from(fileReferences)
    .where(inArray(fileReferences.id, [...referenceIds]))
    .all();
  for (const r of rows)
    map.set(r.id, buildCoverUrl(r.fileId, r.id));
  return map;
}

async function loadCoverUrlForShip(db: AppDatabase, row: ShipRow): Promise<string | null> {
  if (!row.coverReferenceId)
    return null;
  return (await loadCoverUrlsByReference(db, [row.coverReferenceId])).get(row.coverReferenceId) ?? null;
}

/** Map internal project ids to their short ids (skips soft-deleted projects). */
async function loadProjectShortIds(db: AppDatabase, internalIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = internalIds.filter(id => id.length > 0);
  if (ids.length === 0)
    return map;
  const rows = await db.select({ id: projects.id, shortId: projects.shortId })
    .from(projects)
    .where(inArray(projects.id, [...new Set(ids)]))
    .all();
  for (const r of rows)
    map.set(r.id, r.shortId);
  return map;
}

/** Compose a single ship view, resolving its base project short id, cover, and tags. */
export async function composeShipWithBase(db: AppDatabase, row: ShipRow): Promise<ShipView> {
  const coverUrl = await loadCoverUrlForShip(db, row);
  const tags = (await loadResourceTagsByResource(db, SHIP_TAG_BINDING, [row.id])).get(row.id) ?? [];
  if (!row.baseProjectId)
    return composeShip(row, null, coverUrl, tags);
  const map = await loadProjectShortIds(db, [row.baseProjectId]);
  return composeShip(row, map.get(row.baseProjectId) ?? null, coverUrl, tags);
}

// ─── Ship CRUD ────────────────────────────────────────────────────────────

export interface CreateShipInput {
  readonly code?: string | undefined;
  readonly name: string;
  readonly status?: ShipStatus | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly model?: string | null | undefined;
  readonly builder?: string | null | undefined;
  readonly buildYear?: number | null | undefined;
  readonly lengthOverall?: number | null | undefined;
  readonly beam?: number | null | undefined;
  readonly draft?: number | null | undefined;
  readonly grossTonnage?: number | null | undefined;
  readonly imoNumber?: string | null | undefined;
  readonly mmsi?: string | null | undefined;
  readonly callSign?: string | null | undefined;
  readonly flagState?: string | null | undefined;
  readonly registryPort?: string | null | undefined;
  readonly ownerName?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly creatorId: string;
}

/**
 * Create a ship and its base project atomically. Order inside the single
 * synchronous transaction (required by the nullable circular FK
 * `ships.base_project_id ↔ projects.ship_id`): insert ship (base project
 * null) → create base project (with `shipId` back-pointer, creator seeded as
 * PM) → backfill `ships.base_project_id`.
 */
export async function createShip(db: AppDatabase, input: CreateShipInput): Promise<ShipRow> {
  const id = ulid();
  const shortId = nanoid();
  const code = input.code ?? `S-${shortId.toUpperCase()}`;
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(ships).values({
      id,
      shortId,
      code,
      name: input.name,
      status: input.status ?? "active",
      baseProjectId: null,
      model: input.model ?? null,
      builder: input.builder ?? null,
      buildYear: input.buildYear ?? null,
      lengthOverall: input.lengthOverall ?? null,
      beam: input.beam ?? null,
      draft: input.draft ?? null,
      grossTonnage: input.grossTonnage ?? null,
      imoNumber: input.imoNumber ?? null,
      mmsi: input.mmsi ?? null,
      callSign: input.callSign ?? null,
      flagState: input.flagState ?? null,
      registryPort: input.registryPort ?? null,
      ownerName: input.ownerName ?? null,
      description: input.description ?? null,
      creatorId: input.creatorId,
      version: 1,
      deletedAt: null,
      updatedAt: now,
    }).run();

    const project = createProjectTx(tx, {
      name: input.name,
      creatorId: input.creatorId,
      shipId: id,
    });

    tx.update(ships).set({ baseProjectId: project.id }).where(eq(ships.id, id)).run();

    if (input.tags && input.tags.length > 0)
      syncResourceTagsTx(tx, SHIP_TAG_BINDING, id, input.tags, now);
  });

  return (await db.select().from(ships).where(eq(ships.id, id)).get())!;
}

export async function getShipByShortId(db: AppDatabase, shortId: string): Promise<ShipRow | undefined> {
  return await db.select().from(ships).where(
    and(eq(ships.shortId, shortId), isNull(ships.deletedAt)),
  ).get();
}

/** Resolve the internal ship id (ULID) from a short id, excluding soft-deleted rows. */
export async function resolveShipId(db: AppDatabase, shortId: string): Promise<string | null> {
  const row = await db.select({ id: ships.id }).from(ships).where(
    and(eq(ships.shortId, shortId), isNull(ships.deletedAt)),
  ).get();
  return row?.id ?? null;
}

export interface ListShipParams {
  readonly status?: ShipStatus | undefined;
  readonly tagId?: string | undefined;
  readonly q?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  // When set (non-admin callers), restrict to ships whose base project this
  // user is a member of.
  readonly memberUserId?: string | undefined;
}

export interface ListShipResult {
  readonly data: readonly ShipView[];
  readonly total: number;
}

export async function listShips(db: AppDatabase, params: ListShipParams = {}): Promise<ListShipResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const conditions = [isNull(ships.deletedAt)];
  if (params.status)
    conditions.push(eq(ships.status, params.status));
  if (params.tagId) {
    const taggedIds = await listResourceIdsByTag(db, SHIP_TAG_BINDING, params.tagId);
    if (taggedIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(ships.id, taggedIds));
  }
  if (params.q) {
    const pattern = `%${escapeLike(params.q)}%`;
    conditions.push(or(
      sql`${ships.name} LIKE ${pattern} ESCAPE '\\'`,
      sql`${ships.code} LIKE ${pattern} ESCAPE '\\'`,
    )!);
  }
  if (params.memberUserId !== undefined) {
    // Restrict to ships whose base project the user belongs to via an IN
    // subquery (SQL-level join on ships.baseProjectId), instead of loading
    // every membership row into app memory. An empty membership set yields no
    // matches naturally.
    conditions.push(inArray(
      ships.baseProjectId,
      db.select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, params.memberUserId)),
    ));
  }
  const where = and(...conditions);

  const totalRow = await db.select({ value: count() }).from(ships).where(where).get();
  const total = totalRow?.value ?? 0;

  const rows = await db.select().from(ships).where(where).orderBy(desc(ships.id)).limit(limit).offset((page - 1) * limit).all();
  const baseIds = rows.map(r => r.baseProjectId).filter((v): v is string => v !== null);
  const shortIdMap = await loadProjectShortIds(db, baseIds);
  const coverRefIds = rows.map(r => r.coverReferenceId).filter((v): v is string => v !== null);
  const coverMap = await loadCoverUrlsByReference(db, coverRefIds);
  const tagMap = await loadResourceTagsByResource(db, SHIP_TAG_BINDING, rows.map(r => r.id));
  const data = rows.map(r => composeShip(
    r,
    r.baseProjectId ? shortIdMap.get(r.baseProjectId) ?? null : null,
    r.coverReferenceId ? coverMap.get(r.coverReferenceId) ?? null : null,
    tagMap.get(r.id) ?? [],
  ));

  return { data, total };
}

export interface UpdateShipInput {
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly status?: ShipStatus | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly model?: string | null | undefined;
  readonly builder?: string | null | undefined;
  readonly buildYear?: number | null | undefined;
  readonly lengthOverall?: number | null | undefined;
  readonly beam?: number | null | undefined;
  readonly draft?: number | null | undefined;
  readonly grossTonnage?: number | null | undefined;
  readonly imoNumber?: string | null | undefined;
  readonly mmsi?: string | null | undefined;
  readonly callSign?: string | null | undefined;
  readonly flagState?: string | null | undefined;
  readonly registryPort?: string | null | undefined;
  readonly ownerName?: string | null | undefined;
  readonly description?: string | null | undefined;
}

const UPDATABLE_SHIP_KEYS = [
  "code",
  "name",
  "status",
  "model",
  "builder",
  "buildYear",
  "lengthOverall",
  "beam",
  "draft",
  "grossTonnage",
  "imoNumber",
  "mmsi",
  "callSign",
  "flagState",
  "registryPort",
  "ownerName",
  "description",
] as const;

export async function updateShip(db: AppDatabase, shortId: string, input: UpdateShipInput): Promise<ShipRow | undefined> {
  const ship = await getShipByShortId(db, shortId);
  if (!ship)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now, version: sql`${ships.version} + 1` };
  for (const key of UPDATABLE_SHIP_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  db.transaction((tx) => {
    tx.update(ships).set(patch).where(eq(ships.id, ship.id)).run();
    // Only replace tags when the caller supplied them (mirrors project update).
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, SHIP_TAG_BINDING, ship.id, input.tags, now);
  });
  return await db.select().from(ships).where(eq(ships.id, ship.id)).get();
}

/**
 * Soft-delete a ship (stamp `deleted_at`). To preserve project data (per
 * PLAN-011 Risk), every project linked to this ship — base project included —
 * is unbound (`projects.ship_id = null`) and the ship's `base_project_id` is
 * cleared. The cover image reference is released so its file ref-count is not
 * leaked. `ship_equipment` and ship-level `maintenance_templates` are left in
 * place; they become unreachable with their soft-deleted ship.
 */
export async function softDeleteShip(db: AppDatabase, config: FileServiceConfig, shortId: string): Promise<void> {
  const ship = await db.select().from(ships).where(eq(ships.shortId, shortId)).get();
  if (!ship || ship.deletedAt)
    return;
  const now = new Date().toISOString();
  const previousCover = ship.coverReferenceId;
  db.transaction((tx) => {
    tx.update(projects).set({ shipId: null }).where(eq(projects.shipId, ship.id)).run();
    tx.update(ships)
      .set({ baseProjectId: null, coverReferenceId: null, deletedAt: now, updatedAt: now, version: sql`${ships.version} + 1` })
      .where(eq(ships.id, ship.id))
      .run();
  });
  // Drop tag assignments (tags_refs has no FK, so clean them app-level).
  await deleteResourceTags(db, ship.id);
  if (previousCover)
    await releaseReference(db, config, { referenceId: previousCover });
}

// ─── Cover image ──────────────────────────────────────────────────────────
//
// Mirrors the project cover (FEAT-011). One cover per ship, modelled as a
// `ship_cover` file reference. The pointer is repointed BEFORE the previous
// reference is released, because the SQLite `ALTER TABLE ADD COLUMN` FK cannot
// carry an `ON DELETE SET NULL` action.

/** Load a ship by internal id (ULID), including soft-deleted rows. */
export async function getShipById(db: AppDatabase, id: string): Promise<ShipRow | undefined> {
  return await db.select().from(ships).where(eq(ships.id, id)).get();
}

/** Replace a ship's cover image. Returns the updated row, or undefined when the ship is gone. */
export async function setShipCover(
  db: AppDatabase,
  config: Config,
  shipInternalId: string,
  file: File,
  uploadedBy: string,
): Promise<ShipRow | undefined> {
  const ship = await getShipById(db, shipInternalId);
  if (!ship)
    return undefined;

  const { reference } = await uploadAndReference(db, config, {
    file,
    ownerType: SHIP_COVER_OWNER_TYPE,
    ownerId: shipInternalId,
    uploadedBy,
  });

  const now = new Date().toISOString();
  // Repoint to the new reference; if that write fails, release the freshly
  // uploaded reference so it is not orphaned (uploaded + referenced but no
  // ship points to it). The previous reference is only released once the
  // repoint has committed.
  try {
    await db.update(ships)
      .set({ coverReferenceId: reference.id, updatedAt: now, version: sql`${ships.version} + 1` })
      .where(eq(ships.id, shipInternalId))
      .run();
  }
  catch (err) {
    await releaseReference(db, config, { referenceId: reference.id });
    throw err;
  }

  const previous = ship.coverReferenceId;
  if (previous && previous !== reference.id)
    await releaseReference(db, config, { referenceId: previous });

  return await getShipById(db, shipInternalId);
}

/** Remove a ship's cover image (no-op when it has none). */
export async function removeShipCover(
  db: AppDatabase,
  config: FileServiceConfig,
  shipInternalId: string,
): Promise<ShipRow | undefined> {
  const ship = await getShipById(db, shipInternalId);
  if (!ship)
    return undefined;
  const previous = ship.coverReferenceId;
  if (!previous)
    return ship;

  const now = new Date().toISOString();
  await db.update(ships)
    .set({ coverReferenceId: null, updatedAt: now, version: sql`${ships.version} + 1` })
    .where(eq(ships.id, shipInternalId))
    .run();
  await releaseReference(db, config, { referenceId: previous });

  return await getShipById(db, shipInternalId);
}

// ─── Permission helpers (anchored on the base project) ─────────────────────

/** True when the user may read the ship: admin, or a member of its base project. */
export async function userCanReadShip(db: AppDatabase, ship: ShipRow, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin)
    return true;
  if (!ship.baseProjectId)
    return false;
  return isMember(db, ship.baseProjectId, userId);
}

/** True when the user may manage the ship: admin, or `project.manage` on its base project. */
export async function userCanManageShip(db: AppDatabase, ship: ShipRow, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin)
    return true;
  if (!ship.baseProjectId)
    return false;
  return hasCapability(db, ship.baseProjectId, userId, "project.manage");
}

// ─── Ship ↔ project binding ────────────────────────────────────────────────

/** List the base project and every additionally bound project of a ship. */
export async function listShipProjects(db: AppDatabase, shipInternalId: string, baseProjectId: string | null): Promise<readonly ShipProjectView[]> {
  const rows = await db.select().from(projects).where(
    and(eq(projects.shipId, shipInternalId), isNull(projects.deletedAt)),
  ).orderBy(desc(projects.id)).all();
  return rows.map(r => ({ ...composeProject(r), isBase: r.id === baseProjectId }));
}

export type BindResult = "not_found" | "is_base" | "bound_elsewhere" | "ok";

/**
 * Bind an existing project to a ship (set `projects.ship_id`). Refuses to bind
 * a project that is already bound to a different ship — whether as that ship's
 * base project (which would sever its permission anchor) or merely as an extra
 * — so binding never silently steals a project from another ship.
 */
export async function bindProject(db: AppDatabase, shipInternalId: string, projectShortId: string): Promise<BindResult> {
  const project = await db.select({ id: projects.id, shipId: projects.shipId }).from(projects).where(
    and(eq(projects.shortId, projectShortId), isNull(projects.deletedAt)),
  ).get();
  if (!project)
    return "not_found";
  if (project.shipId === shipInternalId)
    return "ok"; // already bound to this ship (idempotent)
  if (project.shipId !== null) {
    // Bound to another ship. Distinguish a base project (clearer message) from
    // an extra binding; either way we refuse rather than steal it.
    const owningBase = await db.select({ id: ships.id }).from(ships).where(
      and(eq(ships.baseProjectId, project.id), isNull(ships.deletedAt)),
    ).get();
    return owningBase ? "is_base" : "bound_elsewhere";
  }
  await db.update(projects).set({ shipId: shipInternalId }).where(eq(projects.id, project.id)).run();
  return "ok";
}

export type UnbindResult = "not_found" | "is_base" | "ok";

/**
 * Unbind a project from a ship (`projects.ship_id = null`). The base project
 * cannot be unbound — it is the ship's permission anchor and file carrier.
 */
export async function unbindProject(db: AppDatabase, shipInternalId: string, baseProjectId: string | null, projectShortId: string): Promise<UnbindResult> {
  const project = await db.select({ id: projects.id, shipId: projects.shipId }).from(projects).where(
    and(eq(projects.shortId, projectShortId), isNull(projects.deletedAt)),
  ).get();
  if (!project || project.shipId !== shipInternalId)
    return "not_found";
  if (project.id === baseProjectId)
    return "is_base";
  await db.update(projects).set({ shipId: null }).where(eq(projects.id, project.id)).run();
  return "ok";
}
