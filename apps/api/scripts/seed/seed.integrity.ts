/**
 * Post-seed mount integrity check (PLAN-108).
 *
 * A project's tabs are driven entirely by its `project_sections` rows, so a
 * missing mount row does not fail anything — it silently hides a core tab. The
 * seed therefore asserts the invariant itself after importing, and the sibling
 * test enforces the same rule in CI.
 *
 * Invariant: every non-deleted project carries at least the `general` preset's
 * sections (`issues`, `procurement`, `files`); a ship project — one holding a
 * `ship_profiles` row — additionally carries the three maritime sections. The
 * profile row is the marker on purpose: it is written by a different section's
 * provision hook than the mount rows being validated, so a dropped
 * `ship-profile` mount is still detected.
 */
import type { AppDatabase } from "@/db";
import type { ProjectPreset } from "@/modules/project/section.registry";
import { isNull } from "drizzle-orm";
import { projects } from "@/modules/project/schema";
import { PROJECT_PRESETS } from "@/modules/project/section.registry";
import { loadSectionsForProjects } from "@/modules/project/section.service";
import { shipProfiles } from "@/modules/ship/schema";

export interface MountViolation {
  readonly shortId: string;
  readonly name: string;
  /** Which preset's sections the project was measured against. */
  readonly preset: ProjectPreset;
  readonly missing: readonly string[];
}

export interface MountIntegrityReport {
  readonly projects: number;
  readonly ships: number;
  readonly violations: readonly MountViolation[];
}

/** Measure every non-deleted project against the preset its data says it is. */
export async function checkMountIntegrity(db: AppDatabase): Promise<MountIntegrityReport> {
  const rows = await db.select({ id: projects.id, shortId: projects.shortId, name: projects.name })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .all();
  if (rows.length === 0)
    return { projects: 0, ships: 0, violations: [] };

  const sections = await loadSectionsForProjects(db, rows.map(r => r.id));
  const shipIds = new Set(
    (await db.select({ projectId: shipProfiles.projectId }).from(shipProfiles).all())
      .map(r => r.projectId),
  );

  const violations: MountViolation[] = [];
  for (const row of rows) {
    const preset: ProjectPreset = shipIds.has(row.id) ? "ship" : "general";
    const mounted = new Set(sections.get(row.id) ?? []);
    const missing = PROJECT_PRESETS[preset].filter(key => !mounted.has(key));
    if (missing.length > 0)
      violations.push({ shortId: row.shortId, name: row.name, preset, missing });
  }

  return { projects: rows.length, ships: shipIds.size, violations };
}

/**
 * Fail loudly when any project is missing a section its preset must mount.
 * Called at the end of the seed so a provisioning regression cannot produce a
 * database that merely looks fine.
 */
export async function assertMountIntegrity(db: AppDatabase): Promise<MountIntegrityReport> {
  const report = await checkMountIntegrity(db);
  if (report.violations.length > 0) {
    const detail = report.violations
      .map(v => `  - ${v.name} (${v.shortId}, ${v.preset}): missing ${v.missing.join(", ")}`)
      .join("\n");
    throw new Error(`Project section mount integrity check failed for ${report.violations.length} project(s):\n${detail}`);
  }
  return report;
}
