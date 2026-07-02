import type { FavoriteTargetType } from "./schema";
import type { AppDatabase } from "@/db";
import type { IssuePriority, IssueStatus } from "@/modules/issue/issue.service";
import type { ProcurementPriority, ProcurementStatus } from "@/modules/procurement/schema";
import type { ProjectCapability } from "@/modules/project/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { procurementDetails } from "@/modules/procurement/schema";
import { parseCapabilities } from "@/modules/project/project.roles";
import { getMemberCapabilities, isMember, resolveProjectId } from "@/modules/project/project.service";
import { projectMembers, projectRoles, projects } from "@/modules/project/schema";
import { userFavorites } from "./schema";

// Actor shape shared by every read path: `null` capability map = app admin
// (sees everything); otherwise visibility is the caller's membership rows.
interface Actor {
  readonly id: string;
  readonly role: string;
}

// Non-terminal statuses surfaced on the overview workbench.
const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = ["todo", "working", "review"];
const OPEN_PROCUREMENT_STATUSES: readonly ProcurementStatus[] = ["requested", "ordered", "confirmed", "paid", "in_transit"];

const OVERVIEW_SECTION_LIMIT = 10;

/**
 * The caller's project capabilities in ONE query (projectMembers ⋈
 * projectRoles), keyed by internal project id. `null` for app admins — they
 * bypass membership entirely, mirroring `requireProjectMember`.
 */
async function memberCapabilityMap(db: AppDatabase, actor: Actor): Promise<Map<string, Set<ProjectCapability>> | null> {
  if (actor.role === "admin")
    return null;
  const rows = await db
    .select({ projectId: projectMembers.projectId, capabilities: projectRoles.capabilities })
    .from(projectMembers)
    .innerJoin(projectRoles, eq(projectRoles.id, projectMembers.roleId))
    .where(eq(projectMembers.userId, actor.id))
    .all();
  const map = new Map<string, Set<ProjectCapability>>();
  for (const row of rows)
    map.set(row.projectId, new Set(parseCapabilities(row.capabilities)));
  return map;
}

// ─── Favorites ────────────────────────────────────────────────────────

export interface FavoriteProjectView {
  readonly targetType: "project";
  readonly id: string; // project short_id
  readonly name: string;
  readonly code: string;
  readonly status: string;
  readonly favoritedAt: string;
}

export interface FavoriteIssueView {
  readonly targetType: "issue";
  readonly id: string; // item short_id
  readonly title: string;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
  readonly dueDate: string | null;
  readonly projectId: string; // project short_id
  readonly projectName: string;
  readonly favoritedAt: string;
}

export interface FavoriteProcurementView {
  readonly targetType: "procurement";
  readonly id: string; // item short_id
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly projectId: string; // project short_id
  readonly projectName: string;
  readonly favoritedAt: string;
}

export type FavoriteView = FavoriteProjectView | FavoriteIssueView | FavoriteProcurementView;

const CAPABILITY_BY_ITEM_TYPE = {
  issue: "issue.view",
  procurement: "procurement.view",
} as const satisfies Record<"issue" | "procurement", ProjectCapability>;

/**
 * Resolve a favorite target from its URL short id to its internal id, ONLY if
 * the actor can currently view it. Every failure mode (unknown id, deleted
 * target, non-member, member without the type's view capability) returns
 * `null` so the route surfaces one uniform 404 — never an existence oracle.
 */
export async function resolveFavoriteTarget(
  db: AppDatabase,
  actor: Actor,
  targetType: FavoriteTargetType,
  shortId: string,
): Promise<string | null> {
  if (targetType === "project") {
    const projectId = await resolveProjectId(db, shortId);
    if (!projectId)
      return null;
    if (actor.role === "admin" || await isMember(db, projectId, actor.id))
      return projectId;
    return null;
  }

  const details = targetType === "issue" ? issueDetails : procurementDetails;
  const row = await db
    .select({ id: items.id, projectId: details.projectId })
    .from(items)
    .innerJoin(details, eq(details.itemId, items.id))
    .innerJoin(projects, eq(projects.id, details.projectId))
    .where(and(
      eq(items.shortId, shortId),
      eq(items.type, targetType),
      isNull(items.deletedAt),
      isNull(projects.deletedAt),
    ))
    .get();
  if (!row)
    return null;
  if (actor.role === "admin")
    return row.id;
  const caps = await getMemberCapabilities(db, row.projectId, actor.id);
  if (!caps || !caps.has(CAPABILITY_BY_ITEM_TYPE[targetType]))
    return null;
  return row.id;
}

/**
 * Lenient short-id → internal-id resolution for DELETE: unfavoriting must
 * keep working after the target was archived, soft-deleted, or the caller
 * lost access (the response is identical either way, so nothing leaks).
 */
export async function resolveFavoriteTargetForRemoval(
  db: AppDatabase,
  targetType: FavoriteTargetType,
  shortId: string,
): Promise<string | null> {
  if (targetType === "project") {
    const row = await db.select({ id: projects.id }).from(projects).where(eq(projects.shortId, shortId)).get();
    return row?.id ?? null;
  }
  const row = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.shortId, shortId), eq(items.type, targetType)))
    .get();
  return row?.id ?? null;
}

/** Idempotent add — re-favoriting an existing favorite is a no-op. */
export async function addFavorite(db: AppDatabase, userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
  await db.insert(userFavorites)
    .values({ userId, targetType, targetId })
    .onConflictDoNothing()
    .run();
}

/** Idempotent remove. */
export async function removeFavorite(db: AppDatabase, userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
  await db.delete(userFavorites).where(and(
    eq(userFavorites.userId, userId),
    eq(userFavorites.targetType, targetType),
    eq(userFavorites.targetId, targetId),
  )).run();
}

/**
 * The caller's favorites hydrated for display, most recently favorited first.
 *
 * Visibility is re-checked on every read and fail-closed: a target the caller
 * can no longer view (left the project, capability revoked, target or its
 * project soft-deleted) is omitted but its row is KEPT — access may return.
 * Rows whose target row is gone entirely (hard delete) are pruned.
 */
export async function listFavorites(db: AppDatabase, actor: Actor): Promise<FavoriteView[]> {
  const favs = await db.select().from(userFavorites).where(eq(userFavorites.userId, actor.id)).orderBy(desc(userFavorites.createdAt), desc(userFavorites.targetId)).all();
  if (favs.length === 0)
    return [];

  const projectIds = favs.filter(f => f.targetType === "project").map(f => f.targetId);
  const issueIds = favs.filter(f => f.targetType === "issue").map(f => f.targetId);
  const procurementIds = favs.filter(f => f.targetType === "procurement").map(f => f.targetId);

  const capMap = await memberCapabilityMap(db, actor);
  const canSeeProject = (projectId: string): boolean => capMap === null || capMap.has(projectId);
  const canSeeItem = (projectId: string, type: "issue" | "procurement"): boolean =>
    capMap === null || (capMap.get(projectId)?.has(CAPABILITY_BY_ITEM_TYPE[type]) ?? false);

  const views = new Map<string, FavoriteView>();
  const existing = new Set<string>();
  const key = (type: FavoriteTargetType, id: string): string => `${type}:${id}`;

  if (projectIds.length > 0) {
    // Existence (any state) drives pruning; the live filter drives display.
    const allRows = await db.select({ id: projects.id, shortId: projects.shortId, name: projects.name, code: projects.code, status: projects.status, deletedAt: projects.deletedAt })
      .from(projects)
      .where(inArray(projects.id, projectIds))
      .all();
    for (const row of allRows) {
      existing.add(key("project", row.id));
      if (row.deletedAt === null && canSeeProject(row.id)) {
        views.set(key("project", row.id), {
          targetType: "project",
          id: row.shortId,
          name: row.name,
          code: row.code,
          status: row.status,
          favoritedAt: "",
        });
      }
    }
  }

  const hydrateItems = async (type: "issue" | "procurement", ids: string[]): Promise<void> => {
    if (ids.length === 0)
      return;
    for (const row of await db.select({ id: items.id }).from(items).where(inArray(items.id, ids)).all())
      existing.add(key(type, row.id));
    const details = type === "issue" ? issueDetails : procurementDetails;
    const rows = await db
      .select({ item: items, details, projectShortId: projects.shortId, projectName: projects.name })
      .from(items)
      .innerJoin(details, eq(details.itemId, items.id))
      .innerJoin(projects, eq(projects.id, details.projectId))
      .where(and(inArray(items.id, ids), eq(items.type, type), isNull(items.deletedAt), isNull(projects.deletedAt)))
      .all();
    for (const row of rows) {
      if (!canSeeItem(row.details.projectId, type))
        continue;
      if (type === "issue") {
        const d = row.details as typeof issueDetails.$inferSelect;
        views.set(key(type, row.item.id), {
          targetType: "issue",
          id: row.item.shortId,
          title: row.item.title,
          status: row.item.status as IssueStatus,
          priority: (d.priority ?? "low") as IssuePriority,
          dueDate: d.dueDate ?? null,
          projectId: row.projectShortId,
          projectName: row.projectName,
          favoritedAt: "",
        });
      }
      else {
        const d = row.details as typeof procurementDetails.$inferSelect;
        views.set(key(type, row.item.id), {
          targetType: "procurement",
          id: row.item.shortId,
          itemName: d.itemName,
          status: row.item.status as ProcurementStatus,
          amount: d.amount,
          currency: d.currency,
          projectId: row.projectShortId,
          projectName: row.projectName,
          favoritedAt: "",
        });
      }
    }
  };
  await hydrateItems("issue", issueIds);
  await hydrateItems("procurement", procurementIds);

  // Lazy prune: targets hard-deleted from their own table.
  const gone = favs.filter(f => !existing.has(key(f.targetType, f.targetId)));
  for (const f of gone) {
    await db.delete(userFavorites).where(and(
      eq(userFavorites.userId, actor.id),
      eq(userFavorites.targetType, f.targetType),
      eq(userFavorites.targetId, f.targetId),
    )).run();
  }

  const out: FavoriteView[] = [];
  for (const f of favs) {
    const view = views.get(key(f.targetType, f.targetId));
    if (view)
      out.push({ ...view, favoritedAt: f.createdAt });
  }
  return out;
}

// ─── Overview aggregates ──────────────────────────────────────────────

export interface OverviewIssueRow {
  readonly id: string; // item short_id
  readonly title: string;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
  readonly dueDate: string | null;
  readonly projectId: string; // project short_id
  readonly projectName: string;
  readonly updatedAt: string;
}

export interface OverviewProcurementRow {
  readonly id: string; // item short_id
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly priority: ProcurementPriority;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly dueDate: string | null;
  readonly projectId: string; // project short_id
  readonly projectName: string;
  readonly updatedAt: string;
}

export interface OverviewData {
  readonly myIssues: OverviewIssueRow[];
  readonly openProcurements: OverviewProcurementRow[];
}

/**
 * Cross-project workbench aggregates, fail-closed to the caller:
 *
 * - `myIssues`: open issues whose `item#assignee@user` tuple points at the
 *   caller, restricted (non-admins) to projects they are still a member of —
 *   an assignee always has read access to their own issue.
 * - `openProcurements`: non-terminal procurements across the projects where
 *   the caller holds `procurement.view` (admins: all live projects),
 *   mirroring the per-project list gate.
 */
export async function getOverview(db: AppDatabase, actor: Actor): Promise<OverviewData> {
  const capMap = await memberCapabilityMap(db, actor);

  const myIssues: OverviewIssueRow[] = [];
  const memberProjectIds = capMap === null ? null : [...capMap.keys()];
  if (memberProjectIds === null || memberProjectIds.length > 0) {
    const conditions = [
      eq(items.type, "issue"),
      isNull(items.deletedAt),
      isNull(projects.deletedAt),
      inArray(items.status, [...OPEN_ISSUE_STATUSES]),
    ];
    if (memberProjectIds !== null)
      conditions.push(inArray(issueDetails.projectId, memberProjectIds));
    const rows = await db
      .select({ item: items, details: issueDetails, projectShortId: projects.shortId, projectName: projects.name })
      .from(items)
      .innerJoin(issueDetails, eq(issueDetails.itemId, items.id))
      .innerJoin(projects, eq(projects.id, issueDetails.projectId))
      .innerJoin(relationTuples, and(
        eq(relationTuples.namespace, "item"),
        eq(relationTuples.relation, "assignee"),
        eq(relationTuples.subjectNamespace, "user"),
        eq(relationTuples.objectId, items.id),
        eq(relationTuples.subjectId, actor.id),
      ))
      .where(and(...conditions))
      .orderBy(desc(items.id))
      .limit(OVERVIEW_SECTION_LIMIT)
      .all();
    for (const row of rows) {
      myIssues.push({
        id: row.item.shortId,
        title: row.item.title,
        status: row.item.status as IssueStatus,
        priority: (row.details.priority ?? "low") as IssuePriority,
        dueDate: row.details.dueDate ?? null,
        projectId: row.projectShortId,
        projectName: row.projectName,
        updatedAt: row.item.updatedAt,
      });
    }
  }

  const openProcurements: OverviewProcurementRow[] = [];
  const procurementProjectIds = capMap === null
    ? null
    : [...capMap.entries()].filter(([, caps]) => caps.has("procurement.view")).map(([id]) => id);
  if (procurementProjectIds === null || procurementProjectIds.length > 0) {
    const conditions = [
      eq(items.type, "procurement"),
      isNull(items.deletedAt),
      isNull(projects.deletedAt),
      inArray(items.status, [...OPEN_PROCUREMENT_STATUSES]),
    ];
    if (procurementProjectIds !== null)
      conditions.push(inArray(procurementDetails.projectId, procurementProjectIds));
    const rows = await db
      .select({ item: items, details: procurementDetails, projectShortId: projects.shortId, projectName: projects.name })
      .from(items)
      .innerJoin(procurementDetails, eq(procurementDetails.itemId, items.id))
      .innerJoin(projects, eq(projects.id, procurementDetails.projectId))
      .where(and(...conditions))
      .orderBy(desc(items.id))
      .limit(OVERVIEW_SECTION_LIMIT)
      .all();
    for (const row of rows) {
      openProcurements.push({
        id: row.item.shortId,
        itemName: row.details.itemName,
        status: row.item.status as ProcurementStatus,
        priority: row.details.priority,
        amount: row.details.amount,
        currency: row.details.currency,
        dueDate: row.details.dueDate ?? null,
        projectId: row.projectShortId,
        projectName: row.projectName,
        updatedAt: row.item.updatedAt,
      });
    }
  }

  return { myIssues, openProcurements };
}
