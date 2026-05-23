import type { AppDatabase } from "@/db";
import type { DriveOwner } from "@/modules/drive/drive.service";
import { listMyDocuments } from "@/modules/document/document.service";
import { searchDriveEntriesByOwners } from "@/modules/drive/drive.service";
import { listTeamDirectories } from "@/modules/drive/drive.team-directory.service";
import { searchIssues } from "@/modules/issue/issue.service";
import { listProjects } from "@/modules/project/project.service";

export type SearchHitType = "document" | "issue" | "project" | "drive";

export interface SearchHit {
  readonly type: SearchHitType;
  // Navigation id: short_id for document/issue/project. Drive has no deep
  // link yet, so its entry id is informational only (results open `/drive`).
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  // For issue hits: the owning project's short_id, needed to deep-link into
  // the project-scoped issue route.
  readonly projectId?: string;
}

export interface GlobalSearchParams {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly q: string;
  readonly limit: number;
}

export interface GlobalSearchResult {
  readonly documents: readonly SearchHit[];
  readonly issues: readonly SearchHit[];
  readonly projects: readonly SearchHit[];
  readonly drive: readonly SearchHit[];
}

const EMPTY: GlobalSearchResult = { documents: [], issues: [], projects: [], drive: [] };

/**
 * Resolve the drive owners a user may search within: their personal drive,
 * every team directory they belong to, and every project they are a member of
 * (admins included — drive search is owner-scoped like the rest of search, so
 * we keep one uniform resolution path rather than enumerating all drives).
 */
async function resolveDriveOwners(db: AppDatabase, userId: string): Promise<readonly DriveOwner[]> {
  const [dirs, projectsResult] = await Promise.all([
    listTeamDirectories(db, userId),
    listProjects(db, { memberUserId: userId, limit: 100 }),
  ]);
  return [
    { ownerType: "user", ownerId: userId },
    ...dirs.map(d => ({ ownerType: "team_directory", ownerId: d.id }) as const),
    ...projectsResult.data.map(p => ({ ownerType: "project", ownerId: p.id }) as const),
  ];
}

/**
 * Fan out a single query term to each module's permission-scoped list
 * function and map the rows to a uniform hit shape. No new permission logic:
 * documents/issues/projects/drive each enforce their own access scope.
 */
export async function globalSearch(db: AppDatabase, params: GlobalSearchParams): Promise<GlobalSearchResult> {
  const { userId, isAdmin, q, limit } = params;
  const term = q.trim();
  if (term.length === 0)
    return EMPTY;

  const [docs, issues, projectsResult, driveOwners] = await Promise.all([
    listMyDocuments(db, { userId, q: term, limit }),
    searchIssues(db, { userId, isAdmin, q: term, limit }),
    listProjects(db, { q: term, limit, memberUserId: isAdmin ? undefined : userId }),
    resolveDriveOwners(db, userId),
  ]);

  const drive = await searchDriveEntriesByOwners(db, driveOwners, term, limit);

  return {
    documents: docs.data.map(d => ({ type: "document", id: d.id, title: d.title })),
    issues: issues.map(i => ({ type: "issue", id: i.id, title: i.title, subtitle: i.status, projectId: i.projectId })),
    projects: projectsResult.data.map(p => ({ type: "project", id: p.id, title: p.name, subtitle: p.code })),
    drive: drive.map(e => ({ type: "drive", id: e.id, title: e.name })),
  };
}
