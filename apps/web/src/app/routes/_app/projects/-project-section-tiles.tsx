// Overview tiles, one per MOUNTED section (PLAN-108 §4).
//
// The tiles are CONTRIBUTED by the section registry: `-project-sections.ts`
// declares which entries have a `tile`, and this file only renders whatever
// `visibleProjectSections` returns. That is the point of the design — a ship
// project's overview needs no ship-specific branch here, it simply mounts more
// sections and therefore gets more tiles.
//
// The registry cannot own the metrics (a metric needs a hook, the registry
// holds no state), so the metrics come from one hook per data source below,
// each gated on its own section being mounted: a general project fires no
// maritime requests at all.

import type { ProjectDetailTab } from "./-project-sections";
import type { ProjectCapabilityInfo } from "@/shared/hooks/use-project-capabilities";
import type { ProjectView } from "@/shared/lib/api/projects";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { useProcurements } from "@/shared/lib/api/procurement";
import { useProjectEquipment, useProjectWorklists, useShipProfile } from "@/shared/lib/api/project-sections";
import { hasSection, useProjectIssues } from "@/shared/lib/api/projects";
import { projectSectionLabelKey, visibleProjectSections } from "./-project-sections";

/** A tile's headline value; `undefined` when the section exposes no metric. */
type SectionMetric = string | number | undefined;

/**
 * One metric per section key. `limit: 5` matches the overview's latest-activity
 * queries and the detail header's tab counts, so TanStack Query dedupes all
 * three into a single request per resource instead of firing a count-only one.
 */
function useProjectSectionMetrics(project: ProjectView, caps: ProjectCapabilityInfo): Readonly<Record<string, SectionMetric>> {
  const issues = useProjectIssues(caps.canViewIssues ? project.id : undefined, { limit: 5 });
  const procurements = useProcurements(project.id, { limit: 5 }, caps.canViewProcurement);
  const shipProfile = useShipProfile(hasSection(project, "ship-profile") ? project.id : undefined);
  const equipment = useProjectEquipment(hasSection(project, "equipment") ? project.id : undefined);
  const worklists = useProjectWorklists(hasSection(project, "worklist") ? project.id : undefined);

  return {
    "issues": issues.data?.meta.total,
    "procurement": procurements.data?.meta.total,
    // Files live in the drive tree, which has no cheap project-wide count; the
    // tile stays a labelled shortcut into the tab.
    "files": undefined,
    "ship-profile": shipProfile.data?.hullNumber,
    "equipment": equipment.data?.length,
    "worklist": worklists.data?.length,
  };
}

interface ProjectSectionTilesProps {
  readonly project: ProjectView;
  readonly caps: ProjectCapabilityInfo;
  readonly onOpenTab: (tab: ProjectDetailTab) => void;
}

export function ProjectSectionTiles({ project, caps, onOpenTab }: ProjectSectionTilesProps) {
  // `ships` supplies the maritime tiles' labels; the registry names the
  // namespace per entry.
  const { t } = useTranslation(["projects", "ships"]);
  const metrics = useProjectSectionMetrics(project, caps);
  const tiles = visibleProjectSections({ project, has: caps.has }).filter(entry => entry.tile !== undefined);

  if (tiles.length === 0)
    return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((entry) => {
        const Icon = entry.tile!.icon;
        const label = t(projectSectionLabelKey(entry));
        const metric = metrics[entry.key];
        return (
          <Card key={entry.key} size="sm">
            <CardContent className="p-0">
              <Button
                type="button"
                variant="ghost"
                aria-label={t("projects:overview.openSection", { name: label })}
                className="h-auto w-full flex-col items-start gap-1 px-3 py-2.5 font-normal"
                onClick={() => onOpenTab(entry.key as ProjectDetailTab)}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </span>
                {/* Fixed-height slot so metric-less tiles keep the grid aligned. */}
                <span className="h-5 w-full truncate text-left text-sm font-medium text-foreground">
                  {metric ?? ""}
                </span>
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
