// Overview tab: a two-column dashboard for one ship. Left column holds the
// editable archive, the lifecycle stepper and active maintenance; the right
// column previews quick stats, bound projects and equipment categories. Every
// value is real ship data — editing stays gated on `canManage`.

import type { ReactNode } from "react";
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipLifecycleStage, ShipView } from "@/shared/lib/api/ships";
import { useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  SHIP_LIFECYCLE_STAGES,
  useShipEquipment,
  useShipMaintenanceOrders,
  useShipMaintenanceTemplates,
  useShipProjects,
  useUpdateShip,
} from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/utils";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToUpdate } from "./-ship-form-logic";
import { StatTile } from "./-ship-stats";

interface ShipOverviewTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

const ACTIVE_ORDER_STATUSES = new Set(["open", "in_progress"]);

function Card({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
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
            <Field label={t("field.lifecycleStage")}>
              <Badge variant="outline" className="text-xs">{t(`lifecycle.${ship.lifecycleStage}` as const)}</Badge>
            </Field>
            <Field label={t("field.status")}>
              <Badge variant="outline" className="text-xs">{t(`status.${ship.status}` as const)}</Badge>
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

        <Card title={t("overview.lifecycle")}>
          <LifecycleStepper current={ship.lifecycleStage} t={t} />
        </Card>

        <Card title={t("overview.upcomingMaintenance")}>
          {activeOrders.length === 0
            ? <p className="text-sm text-muted-foreground">{t("overview.upcomingEmpty")}</p>
            : (
                <ul className="space-y-2">
                  {activeOrders.slice(0, 5).map(order => (
                    <li key={order.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                      <span className="min-w-0 truncate text-sm">{order.title}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
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
            <StatTile label={t("detail.metrics.projects")} value={projects.length} />
            <StatTile label={t("detail.metrics.equipment")} value={equipment.length} />
            <StatTile label={t("detail.metrics.templates")} value={templates.length} />
            <StatTile label={t("detail.metrics.workOrders")} value={orders.length} />
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
                        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left hover:border-border hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="min-w-0 truncate text-sm">{project.name}</span>
                        {project.isBase && <Badge variant="secondary" className="shrink-0 text-xs">{t("projects.baseBadge")}</Badge>}
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
                <ul className="space-y-1.5">
                  {equipmentCategories.map(([category, count]) => (
                    <li key={category} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{category}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
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
    <div className="space-y-2 border-t border-dashed pt-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</dl>
    </div>
  );
}

function LifecycleStepper({ current, t }: { readonly current: ShipLifecycleStage; readonly t: (key: string) => string }) {
  const currentIndex = SHIP_LIFECYCLE_STAGES.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-2">
      {SHIP_LIFECYCLE_STAGES.map((stage, index) => {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <li
            key={stage}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              state === "current" && "border-primary bg-primary/10 font-medium text-primary",
              state === "done" && "bg-muted/60 text-muted-foreground",
              state === "todo" && "border-dashed text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                state === "current" ? "bg-primary" : state === "done" ? "bg-muted-foreground" : "bg-border",
              )}
            />
            {t(`lifecycle.${stage}`)}
          </li>
        );
      })}
    </ol>
  );
}
