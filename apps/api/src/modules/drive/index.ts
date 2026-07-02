import type { DriveOwner } from "./drive.service";
import type { AppDatabase } from "@/db";
import { registerBackupContribution } from "@/modules/backup/registry";
import { listProjects } from "@/modules/project/project.service";
import { registerSearchSource } from "@/modules/search/search.registry";
import { driveBackupContribution } from "./drive.backup";
import { searchDriveEntriesByOwners } from "./drive.service";
import { listTeamDirectories } from "./drive.team-directory.service";
import "./drive.file-permission";
// Side-effect import: registers the drive share adapter with the share module.
import "./drive.share-adapter";

export { driveAccess } from "./drive.permission";
export { driveRoutes } from "./drive.routes";

registerBackupContribution(driveBackupContribution);

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

registerSearchSource({
  key: "drive",
  module: "drive",
  search: async ({ db, userId, limit }, q) => {
    const owners = await resolveDriveOwners(db, userId);
    const entries = await searchDriveEntriesByOwners(db, owners, q, limit);
    return entries.map(e => ({ type: "drive" as const, id: e.id, title: e.name }));
  },
});
