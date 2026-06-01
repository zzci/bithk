import type { ReactNode } from "react";
import type { ShipView } from "@/shared/lib/api/ships";
import { Anchor, Calendar, Fingerprint, Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/shared/components/ui/card";
import { ShipStatusBadge } from "./-ship-visuals";

interface ShipProfileTabProps {
  readonly ship: ShipView;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

export function ShipProfileTab({ ship }: ShipProfileTabProps) {
  const { t } = useTranslation("ships");
  const notSet = <span className="text-muted-foreground">{t("overview.notSet")}</span>;
  const text = (value: string | null): ReactNode => value || notSet;
  const num = (value: number | null): ReactNode => value === null ? notSet : <span className="font-mono">{value}</span>;
  const age = ship.buildYear === null ? null : Math.max(0, CURRENT_YEAR - ship.buildYear);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card>
        <CardContent>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("profile.archive")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("profile.archiveDescription")}</p>
            </div>
            <ShipStatusBadge status={ship.status} />
          </div>

          <ProfileSection title={t("overview.section.identity")}>
            <ProfileField label={t("field.name")}>{text(ship.name)}</ProfileField>
            <ProfileField label={t("field.code")} mono>{text(ship.code)}</ProfileField>
            <ProfileField label={t("field.imoNumber")} mono>{text(ship.imoNumber)}</ProfileField>
            <ProfileField label={t("field.mmsi")} mono>{text(ship.mmsi)}</ProfileField>
            <ProfileField label={t("field.callSign")} mono>{text(ship.callSign)}</ProfileField>
            <ProfileField label={t("field.flagState")}>{text(ship.flagState)}</ProfileField>
          </ProfileSection>

          <ProfileSection title={t("overview.section.classification")}>
            <ProfileField label={t("field.builder")}>{text(ship.builder)}</ProfileField>
            <ProfileField label={t("field.model")}>{text(ship.model)}</ProfileField>
            <ProfileField label={t("field.buildYear")}>{num(ship.buildYear)}</ProfileField>
            <ProfileField label={t("profile.age")}>{age === null ? notSet : t("list.card.ageValue", { count: age })}</ProfileField>
            <ProfileField label={t("field.registryPort")}>{text(ship.registryPort)}</ProfileField>
            <ProfileField label={t("field.ownerName")}>{text(ship.ownerName)}</ProfileField>
            <ProfileField label={t("detail.baseProject")} mono>{text(ship.baseProjectId)}</ProfileField>
          </ProfileSection>

          <ProfileSection title={t("overview.section.dimensions")}>
            <ProfileField label={t("field.lengthOverall")}>{num(ship.lengthOverall)}</ProfileField>
            <ProfileField label={t("field.beam")}>{num(ship.beam)}</ProfileField>
            <ProfileField label={t("field.draft")}>{num(ship.draft)}</ProfileField>
            <ProfileField label={t("field.grossTonnage")}>{num(ship.grossTonnage)}</ProfileField>
          </ProfileSection>
        </CardContent>
      </Card>

      <aside className="space-y-3">
        <ProfileSummary icon={<Fingerprint className="size-4" />} label={t("field.imoNumber")} value={ship.imoNumber ?? t("overview.notSet")} />
        <ProfileSummary icon={<Ruler className="size-4" />} label={t("field.lengthOverall")} value={ship.lengthOverall === null ? t("overview.notSet") : String(ship.lengthOverall)} />
        <ProfileSummary icon={<Calendar className="size-4" />} label={t("profile.age")} value={age === null ? t("overview.notSet") : t("list.card.ageValue", { count: age })} />
        <ProfileSummary icon={<Anchor className="size-4" />} label={t("field.registryPort")} value={ship.registryPort ?? t("overview.notSet")} />
      </aside>
    </div>
  );
}

function ProfileSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="border-t border-dashed py-4 first:border-t-0 first:pt-0 last:pb-0">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </div>
  );
}

function ProfileField({ label, mono, children }: { readonly label: string; readonly mono?: boolean; readonly children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 truncate font-mono text-sm" : "mt-1 truncate text-sm"}>{children}</dd>
    </div>
  );
}

function ProfileSummary({ icon, label, value }: { readonly icon: ReactNode; readonly label: string; readonly value: string }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-2 truncate font-mono text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
