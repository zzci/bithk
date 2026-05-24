// Overview tab: the ship's basic info and vessel particulars. The lifecycle
// stage and every other field are editable through the shared form dialog,
// gated on `canManage` (project.manage on the base project, or app admin).

import type { ReactNode } from "react";
import type { ShipFormState } from "./-ship-form-logic";
import type { ShipView } from "@/shared/lib/api/ships";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { useUpdateShip } from "@/shared/lib/api/ships";
import { errorMessage } from "@/shared/lib/errors";
import { ShipFormDialog } from "./-ship-form-dialog";
import { shipFormToUpdate } from "./-ship-form-logic";

interface ShipOverviewTabProps {
  readonly ship: ShipView;
  readonly canManage: boolean;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function ShipOverviewTab({ ship, canManage }: ShipOverviewTabProps) {
  const { t } = useTranslation(["ships", "common"]);
  const [editOpen, setEditOpen] = useState(false);
  const updateShip = useUpdateShip();

  const notSet = <span className="text-muted-foreground">{t("overview.notSet")}</span>;
  const text = (v: string | null): ReactNode => (v && v.length > 0 ? v : notSet);
  const num = (v: number | null): ReactNode => (v === null ? notSet : String(v));

  const handleSubmit = (state: ShipFormState) => {
    updateShip.mutate(
      { id: ship.id, ...shipFormToUpdate(state) },
      { onSuccess: () => setEditOpen(false) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <section className="flex-1 space-y-1.5">
          <h2 className="text-sm font-medium text-muted-foreground">{t("field.description")}</h2>
          <p className="text-sm whitespace-pre-wrap">
            {ship.description || <span className="text-muted-foreground">{t("overview.noDescription")}</span>}
          </p>
        </section>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1 size-4" />
            {t("common:common.edit")}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("field.lifecycleStage")}>
          <Badge variant="outline" className="text-xs">{t(`lifecycle.${ship.lifecycleStage}` as const)}</Badge>
        </Field>
        <Field label={t("field.status")}>
          <Badge variant="outline" className="text-xs">{t(`status.${ship.status}` as const)}</Badge>
        </Field>
        <Field label={t("field.code")}>{text(ship.code)}</Field>
        <Field label={t("field.builder")}>{text(ship.builder)}</Field>
        <Field label={t("field.model")}>{text(ship.model)}</Field>
        <Field label={t("field.buildYear")}>{num(ship.buildYear)}</Field>
        <Field label={t("field.lengthOverall")}>{num(ship.lengthOverall)}</Field>
        <Field label={t("field.beam")}>{num(ship.beam)}</Field>
        <Field label={t("field.draft")}>{num(ship.draft)}</Field>
        <Field label={t("field.grossTonnage")}>{num(ship.grossTonnage)}</Field>
        <Field label={t("field.imoNumber")}>{text(ship.imoNumber)}</Field>
        <Field label={t("field.mmsi")}>{text(ship.mmsi)}</Field>
        <Field label={t("field.callSign")}>{text(ship.callSign)}</Field>
        <Field label={t("field.flagState")}>{text(ship.flagState)}</Field>
        <Field label={t("field.registryPort")}>{text(ship.registryPort)}</Field>
        <Field label={t("field.ownerName")}>{text(ship.ownerName)}</Field>
      </dl>

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
