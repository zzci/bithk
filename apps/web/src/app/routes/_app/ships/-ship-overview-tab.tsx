// Overview tab: a two-column dashboard for one ship. Left column holds the
// read-only archive (the cover upload stays gated on `canManage`); the right
// column previews quick stats, bound projects and equipment categories. Editing
// the ship record lives on the Details (profile) tab.

import type { ReactNode } from "react";
import type { ShipView } from "@/shared/lib/api/ships";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardList, FolderKanban, Package } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Card as UICard,
} from "@/shared/components/ui/card";
import { resolveCategoryName } from "@/shared/lib/api/global-equipment-categories";
import {
  useShipEquipment,
  useShipProjects,
  useShipWorklists,
} from "@/shared/lib/api/ships";
import { RECORD_STATUS_BADGE } from "@/shared/lib/status-colors";
import { cn } from "@/shared/lib/utils";
import { ShipCoverField } from "./-ship-cover-field";
import { StatTile } from "./-ship-stats";
import { ShipStatusBadge } from "./-ship-visuals";

interface ShipOverviewTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

function Card({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <UICard>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
      </CardContent>
    </UICard>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ShipOverviewTab({ ship, canManage }: ShipOverviewTabProps) {
  const { t, i18n } = useTranslation(["ships", "projects", "common"]);
  const isZh = i18n.language?.startsWith("zh") ?? false;
  const navigate = useNavigate();

  const projects = useShipProjects(ship.id).data ?? [];
  const equipmentData = useShipEquipment(ship.id).data;
  const equipment = useMemo(() => equipmentData ?? [], [equipmentData]);
  const worklists = useShipWorklists(ship.id).data ?? [];

  const notSet = <span className="text-muted-foreground">{t("overview.notSet")}</span>;
  const text = (v: string | null): ReactNode => (v && v.length > 0 ? v : notSet);
  const num = (v: number | null): ReactNode => (v === null ? notSet : String(v));

  const equipmentCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of equipment) {
      const key = (item.categoryId ? resolveCategoryName({ nameZh: item.categoryNameZh, nameEn: item.categoryNameEn }, isZh) : "") || t("overview.uncategorized");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [equipment, t, isZh]);

  const equipmentCategoryMax = Math.max(1, ...equipmentCategories.map(([, count]) => count));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card title={t("overview.archive")}>
          {canManage && <ShipCoverField ship={ship} />}

          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {ship.description || t("overview.noDescription")}
          </p>

          <ArchiveSection title={t("overview.section.identity")}>
            <Field label={t("field.code")}>{text(ship.code)}</Field>
            <Field label={t("field.imoNumber")}>{text(ship.imoNumber)}</Field>
            <Field label={t("field.mmsi")}>{text(ship.mmsi)}</Field>
            <Field label={t("field.callSign")}>{text(ship.callSign)}</Field>
            <Field label={t("field.flagState")}>{text(ship.flagState)}</Field>
          </ArchiveSection>

          <ArchiveSection title={t("overview.section.classification")}>
            <Field label={t("field.status")}>
              <ShipStatusBadge status={ship.status} />
            </Field>
            <Field label={t("field.builder")}>{text(ship.builder)}</Field>
            <Field label={t("field.model")}>{text(ship.model)}</Field>
            <Field label={t("field.buildYear")}>{num(ship.buildYear)}</Field>
            <Field label={t("field.ownerName")}>{text(ship.ownerName)}</Field>
            <Field label={t("field.registryPort")}>{text(ship.registryPort)}</Field>
          </ArchiveSection>

          <ArchiveSection title={t("overview.section.dimensions")}>
            <Field label={t("field.lengthOverall")}>{num(ship.lengthOverall)}</Field>
            <Field label={t("field.beam")}>{num(ship.beam)}</Field>
            <Field label={t("field.draft")}>{num(ship.draft)}</Field>
            <Field label={t("field.grossTonnage")}>{num(ship.grossTonnage)}</Field>
          </ArchiveSection>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={t("overview.quickStats")}>
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={<FolderKanban />}
              accent="bg-accent-maint/10 text-accent-maint"
              label={t("detail.metrics.projects")}
              value={projects.length}
            />
            <StatTile
              icon={<Package />}
              accent="bg-success/10 text-success"
              label={t("detail.metrics.equipment")}
              value={equipment.length}
            />
            <StatTile
              icon={<ClipboardList />}
              accent="bg-info/10 text-info"
              label={t("detail.metrics.worklists")}
              value={worklists.length}
            />
          </div>
        </Card>

        <Card
          title={t("overview.boundProjects")}
          action={projects.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{projects.length}</span>
          )}
        >
          {projects.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.boundProjectsEmpty")}</p>
            : (
                <ul className="space-y-2">
                  {projects.slice(0, 4).map(project => (
                    <li key={project.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                        className="flex h-auto w-full flex-col items-stretch gap-1.5 rounded-md border border-border bg-muted/20 px-3 py-2 text-left font-normal hover:border-border hover:bg-muted/40"
                      >
                        <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {project.isBase && (
                            <Badge variant="secondary" className="bg-primary/10 font-medium text-primary">{t("projects.baseBadge")}</Badge>
                          )}
                          <Badge variant="secondary" className={cn(RECORD_STATUS_BADGE[project.status])}>
                            {t(`projects:status.${project.status}` as const)}
                          </Badge>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
        </Card>

        <Card title={t("overview.equipmentCategories")}>
          {equipmentCategories.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.equipmentCategoriesEmpty")}</p>
            : (
                <ul className="space-y-2.5">
                  {equipmentCategories.map(([category, count]) => (
                    <li key={category} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{category}</span>
                        <span className="shrink-0 font-medium tabular-nums">{count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((count / equipmentCategoryMax) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </Card>
      </div>
    </div>
  );
}

function ArchiveSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
    </div>
  );
}
