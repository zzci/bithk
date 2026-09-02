import type { DriveOwner } from "./drive.service";
import type { AppDatabase } from "@/db";
import { registerBackupContribution } from "@/modules/backup/registry";
import { listMemberProjects } from "@/modules/project/project.service";
import { registerProjectSection } from "@/modules/project/section.registry";
import { registerSearchSource } from "@/modules/search/search.registry";
import { driveBackupContribution } from "./drive.backup";
import { hasProjectDriveEntries, searchDriveEntriesByOwners } from "./drive.service";
import { listTeamDirectories } from "./drive.team-directory.service";
import "./drive.file-permission";
// Side-effect import: registers the drive share adapter with the share module.
import "./drive.share-adapter";

export { driveAccess } from "./drive.permission";
export { driveRoutes } from "./drive.routes";

registerBackupContribution(driveBackupContribution);

// The `files` section (PLAN-108 §3), registered from its owning module's barrel
// as an import-time side effect (ADR-009). It governs the PROJECT surface only
// — drive entries with `ownerType = "project"` — and never the top-level
// `/drive` module, which is personal / team-directory storage and exists
// independently of any project. Registry entry only: the drive module already
// owns the tables, and `files.view` / `files.manage` are already project
// capabilities. Nothing to provision — a project starts with an empty root.
registerProjectSection({
  key: "files",
  capabilities: ["files.view", "files.manage"],
  hasData: hasProjectDriveEntries,
});

/**
 * Resolve the drive owners a user may search within: their personal drive,
 * every team directory they belong to, and every project they are a member of
 * (admins included — drive search is owner-scoped like the rest of search, so
 * we keep one uniform resolution path rather than enumerating all drives).
 */
async function resolveDriveOwners(db: AppDatabase, userId: string): Promise<readonly DriveOwner[]> {
  const [dirs, memberProjects] = await Promise.all([
    listTeamDirectories(db, userId),
    listMemberProjects(db, userId),
  ]);
  return [
    { ownerType: "user", ownerId: userId },
    ...dirs.map(d => ({ ownerType: "team_directory", ownerId: d.id }) as const),
    ...memberProjects.map(p => ({ ownerType: "project", ownerId: p.id }) as const),
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
