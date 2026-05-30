// Overview tab: a two-column dashboard for one ship. Left column holds the
// editable archive and active maintenance; the right column previews quick
// stats, bound projects and equipment categories. Every value is real ship
// data — editing stays gated on `canManage`.

import type { ReactNode } from "react";
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipView } from "@/shared/lib/api/ships";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardList, FolderKanban, Package, Pencil, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  useShipEquipment,
  useShipMaintenanceOrders,
  useShipMaintenanceTemplates,
  useShipProjects,
  useUpdateShip,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { ISSUE_STATUS_BADGE } from "./-ship-colors";
import { ShipCoverField } from "./-ship-cover-field";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToUpdate } from "./-ship-form-logic";
import { StatTile } from "./-ship-stats";
import { ShipStatusBadge } from "./-ship-visuals";

interface ShipOverviewTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

const ACTIVE_ORDER_STATUSES = new Set(["todo", "working", "review"]);

const PROJECT_STATUS_BADGE: Record<"active" | "archived", string> = {
  active: "bg-success/10 text-success",
  archived: "bg-muted text-muted-foreground",
};

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
  const { t } = useTranslation(["ships", "projects", "common"]);
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const updateShip = useUpdateShip();

  const projects = useShipProjects(ship.id).data ?? [];
  const equipmentData = useShipEquipment(ship.id).data;
  const equipment = useMemo(() => equipmentData ?? [], [equipmentData]);
  const templates = useShipMaintenanceTemplates(ship.id).data ?? [];
  const orders = useShipMaintenanceOrders(ship.id).data ?? [];

  const notSet = <span className="text-muted-foreground">{t("overview.notSet")}</span>;
  const text = (v: string | null): ReactNode => (v && v.length > 0 ? v : notSet);
  const num = (v: number | null): ReactNode => (v === null ? notSet : String(v));

  const activeOrders = orders.filter(o => ACTIVE_ORDER_STATUSES.has(o.status));

  const equipmentCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of equipment) {
      const key = item.category?.trim() || t("overview.uncategorized");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [equipment, t]);

  const equipmentCategoryMax = Math.max(1, ...equipmentCategories.map(([, count]) => count));

  const handleSubmit = (state: ShipFormState) => {
    updateShip.mutate(
      { id: ship.id, ...shipFormToUpdate(state) },
      { onSuccess: () => setEditOpen(false) },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card
          title={t("overview.archive")}
          action={canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 size-4" />
              {t("common:common.edit")}
            </Button>
          )}
        >
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

        <Card title={t("overview.upcomingMaintenance")}>
          {activeOrders.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.upcomingEmpty")}</p>
            : (
                <ul className="space-y-2">
                  {activeOrders.slice(0, 5).map(order => (
                    <li key={order.id} className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-maint/10 text-accent-maint [&>svg]:size-4">
                        <Wrench />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{order.title}</span>
                      <Badge variant="secondary" className={cn("shrink-0", ISSUE_STATUS_BADGE[order.status])}>
                        {t(`projects:issues.status.${order.status}` as const)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
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
              label={t("detail.metrics.templates")}
              value={templates.length}
            />
            <StatTile
              icon={<Wrench />}
              accent="bg-warning/10 text-warning"
              label={t("detail.metrics.workOrders")}
              value={orders.length}
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
                      <button
                        type="button"
                        onClick={() => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })}
                        className="flex w-full flex-col gap-1.5 rounded-md border bg-muted/20 px-3 py-2 text-left hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {project.isBase && (
                            <Badge variant="secondary" className="bg-primary/10 font-medium text-primary">{t("projects.baseBadge")}</Badge>
                          )}
                          <Badge variant="secondary" className={cn(PROJECT_STATUS_BADGE[project.status])}>
                            {t(`projects:status.${project.status}` as const)}
                          </Badge>
                        </span>
                      </button>
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

      {canManage && (
        <ShipFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          initial={ship}
          pending={updateShip.isPending}
          errorMessage={updateShip.error ? errorMessage(updateShip.error, t("common:common.error.saveFailed")) : null}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function ArchiveSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
    </div>
  );
}
